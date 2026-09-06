import * as THREE from 'three';
import type { CityState } from '../../domain/types';
import { isBuildingAnchor } from '../../simulation/city-simulation';
import { facilityAccessSignature } from '../../buildings/facility-access';
import { createTileModel, createFacilityActors } from '../buildings/models';
import { removeLegacyStreetlight } from '../lighting/streetlights';
import { roadStopMask } from '../infrastructure/road-surface';
import { warpRoadModel, roadCornerHeight } from '../infrastructure/roads';
import { batchGroupSteps, disposeGroup } from './geometry';

// Smaller independently committed regions bound merge cost during city growth.
export const BUILDING_CHUNK_SIZE = 16;
type Chunk = { signature: string; group: THREE.Group; actors: THREE.Group[] };
type Job = {
  key: string;
  signature: string;
  cx: number;
  cz: number;
  state: CityState;
  work?: Generator<void, Chunk>;
};
export function buildingChunkSignature(
  state: CityState,
  cx: number,
  cz: number,
  edge = BUILDING_CHUNK_SIZE,
) {
  const tileAt = (x: number, z: number) =>
    x < 0 || z < 0 || x >= state.size || z >= state.size
      ? undefined
      : state.tiles[z * state.size + x];
  let signature = '';
  for (let z = cz; z < Math.min(cz + edge, state.size); z++)
    for (let x = cx; x < Math.min(cx + edge, state.size); x++) {
      const tile = tileAt(x, z)!;
      signature += `${tile.kind}:${tile.level}:${tile.variation}:${tile.elevation}:${tile.anchor}:${tile.rotation}:${tile.lotWidth ?? 1}:${tile.lotDepth ?? 1}:${tile.ruralCommercial ? 1 : 0};`;
      if (isBuildingAnchor(state, tile)) signature += facilityAccessSignature(state, tile);
      if (tile.kind === 'road' || tile.kind === 'rail') {
        if (tile.kind === 'road') signature += `stop:${roadStopMask(state, tile)};`;
        signature += `grade:${roadCornerHeight(state, x, z)},${roadCornerHeight(state, x + 1, z)},${roadCornerHeight(state, x, z + 1)},${roadCornerHeight(state, x + 1, z + 1)};`;
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const neighbor = tileAt(x + dx, z + dz);
            signature += `${neighbor?.kind}:${neighbor?.elevation};`;
            if (neighbor) signature += facilityAccessSignature(state, neighbor);
          }
      }
    }
  return signature;
}

/** Owns static buildings and their facility actors. Jobs are superseded by key,
 * retain the previous complete chunk until commit, and never publish partial lots. */
export function createBuildingChunks(city: THREE.Group, live: THREE.Group, rock: THREE.Material) {
  const chunks = new Map<string, Chunk>(),
    pending = new Map<string, Job>();
  let visualKey = '';
  let completed = 0,
    canceled = 0,
    maxSliceMs = 0,
    maxStepMs = 0,
    initialBuildMs = 0;
  function* build(job: Job): Generator<void, Chunk> {
    const { state, cx, cz } = job,
      half = state.size / 2,
      source = new THREE.Group(),
      actors: THREE.Group[] = [],
      owned: THREE.BufferGeometry[] = [];
    let committed = false;
    try {
      for (let z = cz; z < Math.min(cz + BUILDING_CHUNK_SIZE, state.size); z++)
        for (let x = cx; x < Math.min(cx + BUILDING_CHUNK_SIZE, state.size); x++) {
          const tile = state.tiles[z * state.size + x];
          if (
            tile.kind === 'empty' ||
            tile.kind === 'water' ||
            tile.kind === 'tree' ||
            !isBuildingAnchor(state, tile)
          )
            continue;
          const model = createTileModel(tile, state);
          if (tile.kind === 'road') removeLegacyStreetlight(model, tile);
          if (tile.kind === 'road' || tile.kind === 'rail') {
            warpRoadModel(model, tile, state);
            model.traverse((object) => {
              if (object instanceof THREE.Mesh) owned.push(object.geometry);
            });
          }
          model.position.x += x - half + 0.5;
          model.position.z += z - half + 0.5;
          model.position.y += Math.max(0, tile.elevation);
          source.add(model);
          const actor = createFacilityActors(tile, state);
          if (actor) {
            actor.position.set(x - half + 0.5, Math.max(0, tile.elevation), z - half + 0.5);
            actors.push(actor);
          }
          if (tile.elevation < 0 && (tile.kind === 'road' || tile.kind === 'rail'))
            for (const offset of [-0.3, 0.3]) {
              const geometry = new THREE.BoxGeometry(0.14, 0.64, 0.14);
              owned.push(geometry);
              const pier = new THREE.Mesh(geometry, rock);
              pier.position.set(x - half + 0.5 + offset, -0.3, z - half + 0.5);
              source.add(pier);
            }
          yield;
        }
      const group = yield* batchGroupSteps(source);
      committed = true;
      return { signature: job.signature, group, actors };
    } finally {
      for (const geometry of owned) geometry.dispose();
      source.clear();
      if (!committed) for (const actor of actors) actor.removeFromParent();
    }
  }
  function remove(chunk: Chunk) {
    disposeGroup(chunk.group);
    for (const actor of chunk.actors) actor.removeFromParent();
  }
  function process(budgetMs: number, target: { x: number; z: number }, frustum?: THREE.Frustum) {
    if (!pending.size) return;
    const start = performance.now();
    const bounds = new THREE.Box3();
    const priority = (job: Job) => {
      const x = job.cx - job.state.size / 2,
        z = job.cz - job.state.size / 2;
      bounds.min.set(x, -2, z);
      bounds.max.set(x + BUILDING_CHUNK_SIZE, 24, z + BUILDING_CHUNK_SIZE);
      const visible = !frustum || frustum.intersectsBox(bounds);
      return (
        (visible ? 0 : 1e8) +
        (x + BUILDING_CHUNK_SIZE / 2 - target.x) ** 2 +
        (z + BUILDING_CHUNK_SIZE / 2 - target.z) ** 2
      );
    };
    const ordered = [...pending.values()]
      .map((job) => ({ job, priority: priority(job) }))
      .sort((a, b) => a.priority - b.priority)
      .map((entry) => entry.job);
    outer: for (const job of ordered) {
      job.work ??= build(job);
      while (true) {
        const before = performance.now(),
          step = job.work.next();
        maxStepMs = Math.max(maxStepMs, performance.now() - before);
        if (step.done) {
          const old = chunks.get(job.key);
          city.add(step.value.group);
          for (const actor of step.value.actors) live.add(actor);
          chunks.set(job.key, step.value);
          if (old) remove(old);
          pending.delete(job.key);
          completed++;
          break;
        }
        if (performance.now() - start >= budgetMs) break outer;
      }
      if (performance.now() - start >= budgetMs) break;
    }
    maxSliceMs = Math.max(maxSliceMs, performance.now() - start);
  }
  return {
    update(state: CityState, immediate = false) {
      // Economy, demand, age and service updates do not change static models.
      // Avoid road-network/facility-halo signature work for those simulation ticks.
      const nextVisualKey = state.tiles
        .map(
          (t) =>
            `${t.kind},${t.level},${t.variation},${t.elevation},${t.anchor},${t.rotation},${t.lotWidth ?? 1},${t.lotDepth ?? 1},${t.ruralCommercial ? 1 : 0}`,
        )
        .join(';');
      if (visualKey === nextVisualKey) return;
      visualKey = nextVisualKey;
      let snapshot: CityState | undefined;
      for (let cz = 0; cz < state.size; cz += BUILDING_CHUNK_SIZE)
        for (let cx = 0; cx < state.size; cx += BUILDING_CHUNK_SIZE) {
          const key = `${cx}:${cz}`,
            signature = buildingChunkSignature(state, cx, cz),
            queued = pending.get(key);
          if (queued?.signature === signature) continue;
          if (queued) {
            queued.work?.return(undefined as never);
            pending.delete(key);
            canceled++;
          }
          if (chunks.get(key)?.signature === signature) continue;
          snapshot ??= { ...state, tiles: state.tiles.map((tile) => ({ ...tile })) };
          pending.set(key, { key, signature, cx, cz, state: snapshot });
        }
      if (immediate) {
        const start = performance.now();
        process(Infinity, { x: 0, z: 0 });
        initialBuildMs = performance.now() - start;
        maxSliceMs = 0;
        maxStepMs = 0;
      }
    },
    process,
    actors: () => [...chunks.values()].map((chunk) => chunk.actors),
    diagnostics: () => ({
      pending: pending.size,
      chunks: chunks.size,
      completed,
      canceled,
      initialBuildMs,
      maxSliceMs,
      maxStepMs,
      chunkSize: BUILDING_CHUNK_SIZE,
    }),
    dispose() {
      for (const job of pending.values()) job.work?.return(undefined as never);
      pending.clear();
      for (const chunk of chunks.values()) remove(chunk);
      chunks.clear();
    },
  };
}
