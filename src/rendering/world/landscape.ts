import * as THREE from 'three';
import type { CityState } from '../../domain/types';
import { landscapeHash, landscapeNoise } from '../../world/terrain';
import { sampleGroundHeight } from './terrain';

interface Instance {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  color: THREE.Color;
}
/** Owns its geometries and materials. Dispose with the scene's ordinary group disposer. */
export function buildLandscapeChunk(
  state: CityState,
  cx: number,
  cz: number,
  chunk: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `landscape-${cx}-${cz}`;
  const trunks: Instance[] = [],
    broadleaf: Instance[] = [],
    conifers: Instance[] = [],
    rocks: Instance[] = [],
    grass: Instance[] = [],
    flowers: Instance[] = [];
  const half = state.size / 2;
  for (let z = cz; z < Math.min(state.size, cz + chunk); z++)
    for (let x = cx; x < Math.min(state.size, cx + chunk); x++) {
      const tile = state.tiles[z * state.size + x];
      if (tile.elevation < 0 || !['tree', 'empty'].includes(tile.kind)) continue;
      const random = (salt: number) =>
        landscapeHash(x * 13 + salt, z * 17 - salt, state.seed + tile.variation);
      if (tile.kind === 'tree') {
        // Small urban plantings remain a single tree; forest interiors form overlapping canopy.
        let neighbors = 0;
        for (const [dx, dz] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ])
          if (
            state.tiles[(z + dz) * state.size + x + dx]?.kind === 'tree' &&
            x + dx >= 0 &&
            x + dx < state.size
          )
            neighbors++;
        const count = neighbors >= 2 ? 3 : 1;
        for (let i = 0; i < count; i++) {
          const px = x - half + 0.2 + random(10 + i * 7) * 0.6,
            pz = z - half + 0.2 + random(11 + i * 7) * 0.6;
          const y = sampleGroundHeight(state, px, pz),
            height = 0.9 + random(12 + i * 7) * 0.85;
          const pine = tile.elevation > 3 || random(13 + i * 7) > 0.58;
          const common = {
            x: px,
            y,
            z: pz,
            sx: 1,
            sy: 1,
            sz: 1,
            yaw: random(14 + i * 7) * Math.PI * 2,
            color: new THREE.Color(0x70634b),
          };
          trunks.push({ ...common, y: y + height * 0.28, sx: 0.065, sy: height * 0.65, sz: 0.065 });
          const hue = pine ? 0.3 : 0.245;
          const color = new THREE.Color().setHSL(
            hue + random(15 + i * 7) * 0.026,
            pine ? 0.25 : 0.31,
            0.24 + random(16 + i * 7) * 0.1,
          );
          if (pine) {
            conifers.push({
              ...common,
              y: y + height * 0.66,
              sx: height * 0.39,
              sy: height * 0.9,
              sz: height * 0.39,
              color,
            });
            conifers.push({
              ...common,
              y: y + height * 0.87,
              sx: height * 0.29,
              sy: height * 0.7,
              sz: height * 0.29,
              color: color.clone().multiplyScalar(1.06),
            });
          } else
            broadleaf.push({
              ...common,
              y: y + height * 0.76,
              sx: height * 0.35,
              sy: height * 0.43,
              sz: height * 0.35,
              color,
            });
        }
      }
      // Keep the small city's explicitly reserved first building area visually clear.
      const starterClear =
        state.size === 40 &&
        Math.abs(x - Math.round(state.size * 0.45 - 0.5)) <= 3 &&
        Math.abs(z - Math.round(state.size * 0.46 - 0.5)) <= 3;
      const meadow = tile.kind === 'empty' && !starterClear;
      const meadowNoise = landscapeNoise(x * 0.13, z * 0.13, state.seed + 503);
      if (meadow && meadowNoise > 0.35) {
        // At most three grass tufts and one flower patch per eligible tile; three shared draw calls per chunk.
        for (let i = 0; i < 3; i++) {
          const px = x - half + 0.16 + random(61 + i * 5) * 0.68,
            pz = z - half + 0.16 + random(62 + i * 5) * 0.68;
          grass.push({
            x: px,
            y: sampleGroundHeight(state, px, pz) + 0.045,
            z: pz,
            sx: 0.1 + random(63 + i * 5) * 0.11,
            sy: 0.07 + random(64 + i * 5) * 0.11,
            sz: 0.05,
            yaw: random(65 + i * 5) * 6.28,
            color: new THREE.Color().setHSL(
              0.2 + random(66 + i * 5) * 0.04,
              0.28,
              0.35 + random(67 + i * 5) * 0.09,
            ),
          });
        }
        if (meadowNoise > 0.52 && random(83) > 0.66) {
          const px = x - half + 0.2 + random(84) * 0.6,
            pz = z - half + 0.2 + random(85) * 0.6;
          flowers.push({
            x: px,
            y: sampleGroundHeight(state, px, pz) + 0.07,
            z: pz,
            sx: 0.12,
            sy: 0.035,
            sz: 0.12,
            yaw: random(86) * 6.28,
            color: new THREE.Color(random(87) > 0.45 ? 0xd6c990 : 0xb1a7bd),
          });
        }
      }
      // Exposed highland stone and occasional lowland fieldstone groups enliven open meadows.
      const exposure = landscapeNoise(
        (x / state.size) * 12,
        (z / state.size) * 12,
        state.seed + 307,
      );
      if (
        !starterClear &&
        ((tile.elevation >= 3 && exposure > 0.48 && random(41) > 0.48) ||
          (meadow && exposure > 0.56 && random(41) > 0.83))
      ) {
        const count = 2 + Math.floor(random(42) * 3);
        for (let i = 0; i < count; i++) {
          const px = x - half + 0.15 + random(45 + i * 5) * 0.7,
            pz = z - half + 0.15 + random(46 + i * 5) * 0.7;
          const scale = 0.15 + random(47 + i * 5) * 0.3 + (tile.elevation > 7 ? 0.18 : 0);
          rocks.push({
            x: px,
            y: sampleGroundHeight(state, px, pz) + scale * 0.22,
            z: pz,
            sx: scale,
            sy: scale * (0.7 + random(48 + i * 5)),
            sz: scale * 0.85,
            yaw: random(49 + i * 5) * 6.28,
            color: new THREE.Color().setHSL(0.12, 0.065, 0.38 + random(50 + i * 5) * 0.16),
          });
        }
      }
    }
  const dummy = new THREE.Object3D();
  function batch(name: string, items: Instance[], geometry: THREE.BufferGeometry) {
    if (!items.length) {
      geometry.dispose();
      return;
    }
    const material = new THREE.MeshStandardMaterial({
      roughness: 1,
      flatShading: name === 'outcrops',
    });
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    mesh.name = name;
    items.forEach((item, index) => {
      dummy.position.set(item.x, item.y, item.z);
      dummy.scale.set(item.sx, item.sy, item.sz);
      dummy.rotation.set(0, item.yaw, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, item.color);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  batch('forest-trunks', trunks, new THREE.CylinderGeometry(0.65, 1, 1, 5));
  batch('forest-broadleaf', broadleaf, new THREE.IcosahedronGeometry(1, 1));
  batch('forest-conifers', conifers, new THREE.ConeGeometry(1, 1, 7));
  batch('outcrops', rocks, new THREE.DodecahedronGeometry(1, 0));
  batch('meadow-grass', grass, new THREE.ConeGeometry(1, 1, 3));
  batch('meadow-wildflowers', flowers, new THREE.IcosahedronGeometry(1, 0));
  group.userData.treeCount = trunks.length;
  group.userData.rockCount = rocks.length;
  group.userData.grassCount = grass.length;
  group.userData.flowerCount = flowers.length;
  return group;
}
export function landscapeChunkSignature(
  state: CityState,
  cx: number,
  cz: number,
  chunk: number,
): string {
  let hash = 2166136261;
  for (let z = Math.max(0, cz - 1); z < Math.min(state.size, cz + chunk + 1); z++)
    for (let x = Math.max(0, cx - 1); x < Math.min(state.size, cx + chunk + 1); x++) {
      const t = state.tiles[z * state.size + x];
      hash = Math.imul(hash ^ Math.round(t.elevation * 2 + 16), 16777619);
      hash = Math.imul(hash ^ (t.kind === 'tree' ? 1 : t.kind === 'empty' ? 2 : 3), 16777619);
      hash = Math.imul(hash ^ t.variation, 16777619);
    }
  return `${state.size}:${state.seed}:${hash >>> 0}`;
}
