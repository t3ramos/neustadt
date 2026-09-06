import * as THREE from 'three';
import { sampleRoadHeight } from './roads';
import type { RoadJunction, TrafficApproach } from '../../traffic/network';
import { ROAD_SURFACE_HEIGHT } from './road-surface';
import { STOP_LINE_OFFSET, type SignalState } from '../../traffic/controller';
import type { CityState, Point } from '../../domain/types';

type SignalColor = SignalState['color'];
const CURB_OFFSET = 0.465;
const HEAD_HEIGHT = 0.53;
const LENS_SPACING = 0.061;
const SIGNAL_COLORS = ['red', 'yellow', 'green'] as const;
const COLORS: Record<SignalColor, number> = { red: 0xff3027, yellow: 0xffbf23, green: 0x35ed75 };
const OFF_COLORS: Record<SignalColor, number> = {
  red: 0x381b1c,
  yellow: 0x39321b,
  green: 0x183527,
};

export interface TrafficSignalFixture {
  approachId: string;
  junctionId: string;
  /** World coordinates. This is the base of the mast on the raised road curb. */
  mast: THREE.Vector3;
  /** The housing's forward axis, pointing toward approaching drivers. */
  facing: Point;
  head: THREE.Vector3;
  stopBar: THREE.Vector3;
  mastRadius: number;
  mastHeight: number;
}

/** Shared placement data for rendering, diagnostics, and obstacle consumers. */
export function getTrafficSignalFixture(
  state: CityState,
  approach: TrafficApproach,
): TrafficSignalFixture | null {
  const { from, entry, direction } = approach;
  if (
    ![from.x, from.z, entry.x, entry.z, direction.x, direction.z].every(Number.isInteger) ||
    Math.abs(direction.x) + Math.abs(direction.z) !== 1 ||
    entry.x - from.x !== direction.x ||
    entry.z - from.z !== direction.z
  )
    return null;
  for (const point of [from, entry]) {
    if (
      point.x < 0 ||
      point.z < 0 ||
      point.x >= state.size ||
      point.z >= state.size ||
      state.tiles[point.z * state.size + point.x]?.kind !== 'road'
    )
      return null;
  }
  const centerX = entry.x + 0.5 - state.size / 2,
    centerZ = entry.z + 0.5 - state.size / 2;
  const rightX = -direction.z,
    rightZ = direction.x;
  // The .67-wide asphalt leaves a .165-wide curb. Its outer corner also clears
  // the .405 pedestrian walking line and the centred facility driveway mouths.
  const x = centerX - direction.x * CURB_OFFSET + rightX * CURB_OFFSET;
  const z = centerZ - direction.z * CURB_OFFSET + rightZ * CURB_OFFSET;
  const ground = sampleRoadHeight(state, x, z);
  const stopOffset = STOP_LINE_OFFSET - 0.025;
  const stopX = centerX - direction.x * stopOffset + rightX * 0.17;
  const stopZ = centerZ - direction.z * stopOffset + rightZ * 0.17;
  return {
    approachId: approach.id,
    junctionId: approach.junctionId,
    mast: new THREE.Vector3(x, ground + 0.045, z),
    facing: { x: -direction.x, z: -direction.z },
    head: new THREE.Vector3(x, ground + HEAD_HEIGHT, z),
    stopBar: new THREE.Vector3(
      stopX,
      sampleRoadHeight(state, stopX, stopZ) + ROAD_SURFACE_HEIGHT,
      stopZ,
    ),
    mastRadius: 0.011,
    mastHeight: 0.495,
  };
}

interface Fixture extends TrafficSignalFixture {
  color: SignalColor;
  yaw: number;
}

/**
 * Automatic curb-mounted three-aspect heads. The traffic controller is the only
 * source of signal colors: there is deliberately no animation clock here.
 * A fixed nine instanced draws, shared geometry, and no per-head real lights keep
 * large maps inexpensive. Unknown or newly created approaches default to red.
 */
export function createTrafficSignals(
  initialState: CityState,
  initialJunctions: readonly RoadJunction[],
) {
  const group = new THREE.Group();
  group.name = 'traffic-signals';
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  const hood = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, true);
  hood.rotateX(Math.PI / 2);
  const lens = new THREE.CircleGeometry(0.5, 12);
  const geometries = [box, cylinder, hood, lens];
  const metal = new THREE.MeshStandardMaterial({
    color: 0x56646b,
    roughness: 0.5,
    metalness: 0.65,
  });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x89918b, roughness: 0.9 });
  const housing = new THREE.MeshStandardMaterial({
    color: 0x182329,
    roughness: 0.7,
    metalness: 0.2,
  });
  const offLens = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.32,
    metalness: 0.1,
  });
  const litMaterials = Object.fromEntries(
    SIGNAL_COLORS.map((color) => [
      color,
      new THREE.MeshStandardMaterial({
        color: COLORS[color],
        emissive: COLORS[color],
        emissiveIntensity: 1.8,
        roughness: 0.28,
        toneMapped: false,
      }),
    ]),
  ) as Record<SignalColor, THREE.MeshStandardMaterial>;
  const materials = [metal, concrete, housing, offLens, ...Object.values(litMaterials)];
  const transform = new THREE.Object3D(),
    colorScratch = new THREE.Color();
  let capacity = 0,
    signature = '',
    disposed = false;
  let fixtures: Fixture[] = [];
  let batches: THREE.InstancedMesh[] = [];
  let bases: THREE.InstancedMesh, poles: THREE.InstancedMesh, backplates: THREE.InstancedMesh;
  let housings: THREE.InstancedMesh, hoods: THREE.InstancedMesh, offLenses: THREE.InstancedMesh;
  let litLenses: Record<SignalColor, THREE.InstancedMesh>;
  let previousSignals = new Map<string, SignalColor>();

  function batch(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    multiplier = 1,
  ) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity * multiplier);
    mesh.name = `traffic-signal-${name}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.drivingObstacle = false;
    group.add(mesh);
    batches.push(mesh);
    return mesh;
  }

  function ensureCapacity(count: number) {
    if (count <= capacity) return;
    for (const mesh of batches) {
      group.remove(mesh);
      mesh.dispose();
    }
    batches = [];
    capacity = Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(1, count))));
    bases = batch('bases', cylinder, concrete);
    poles = batch('poles', cylinder, metal);
    bases.userData.drivingObstacle = poles.userData.drivingObstacle = true;
    backplates = batch('backplates', box, housing);
    housings = batch('housings', box, housing);
    hoods = batch('hoods', hood, housing, 3);
    offLenses = batch('off-lenses', lens, offLens, 3);
    litLenses = Object.fromEntries(
      SIGNAL_COLORS.map((color) => [color, batch(`${color}-lenses`, lens, litMaterials[color])]),
    ) as Record<SignalColor, THREE.InstancedMesh>;
    for (const mesh of [offLenses, ...Object.values(litLenses)])
      mesh.castShadow = mesh.receiveShadow = false;
  }

  function place(
    mesh: THREE.InstancedMesh,
    index: number,
    fixture: Fixture,
    height: number,
    forward: number,
    sx: number,
    sy: number,
    sz: number,
  ) {
    transform.position.set(
      fixture.head.x + fixture.facing.x * forward,
      fixture.head.y + height,
      fixture.head.z + fixture.facing.z * forward,
    );
    transform.rotation.set(0, fixture.yaw, 0);
    transform.scale.set(sx, sy, sz);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  }

  function flush(mesh: THREE.InstancedMesh) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }

  function applySignals() {
    for (const mesh of Object.values(litLenses)) mesh.count = 0;
    for (const fixture of fixtures) {
      const index = SIGNAL_COLORS.indexOf(fixture.color),
        mesh = litLenses[fixture.color];
      place(mesh, mesh.count++, fixture, (1 - index) * LENS_SPACING, 0.033, 0.047, 0.047, 1);
    }
    for (const mesh of Object.values(litLenses)) flush(mesh);
  }

  function update(state: CityState, junctions: readonly RoadJunction[]) {
    if (disposed) return;
    // Neighbouring road and rail heights participate in the shared road corners.
    let checksum = 2166136261;
    for (const tile of state.tiles)
      if (tile.kind === 'road' || tile.kind === 'rail') {
        checksum = Math.imul(checksum ^ (tile.z * state.size + tile.x), 16777619);
        checksum = Math.imul(checksum ^ Math.round(tile.elevation * 65536), 16777619);
        checksum = Math.imul(checksum ^ (tile.kind === 'road' ? 1 : 2), 16777619);
      }
    const approaches = junctions
      .filter((junction) => junction.signalized !== false)
      .flatMap((junction) => junction.approaches);
    const nextSignature =
      `${state.size}:${checksum >>> 0}:` +
      approaches
        .map(
          (a) =>
            `${a.id}/${a.junctionId}/${a.from.x},${a.from.z}/${a.entry.x},${a.entry.z}/${a.direction.x},${a.direction.z}`,
        )
        .join(';');
    if (signature === nextSignature) return;
    signature = nextSignature;
    const seen = new Set<string>();
    fixtures = [];
    for (const approach of approaches) {
      if (seen.has(approach.id)) continue;
      seen.add(approach.id);
      const fixture = getTrafficSignalFixture(state, approach);
      if (fixture)
        fixtures.push({
          ...fixture,
          color: previousSignals.get(approach.id) ?? 'red',
          yaw: Math.atan2(fixture.facing.x, fixture.facing.z),
        });
    }
    ensureCapacity(Math.max(1, fixtures.length));
    for (let i = 0; i < fixtures.length; i++) {
      const fixture = fixtures[i],
        ground = fixture.mast.y - 0.045;
      place(bases, i, fixture, ground + 0.035 - fixture.head.y, 0, 0.055, 0.028, 0.055);
      place(
        poles,
        i,
        fixture,
        fixture.mast.y + fixture.mastHeight / 2 - fixture.head.y,
        0,
        0.022,
        fixture.mastHeight,
        0.022,
      );
      place(backplates, i, fixture, 0, -0.028, 0.097, 0.246, 0.013);
      place(housings, i, fixture, 0, 0, 0.077, 0.22, 0.05);
      for (let aspect = 0; aspect < 3; aspect++) {
        const height = (1 - aspect) * LENS_SPACING;
        place(hoods, i * 3 + aspect, fixture, height, 0.037, 0.058, 0.058, 0.03);
        place(offLenses, i * 3 + aspect, fixture, height, 0.031, 0.047, 0.047, 1);
        offLenses.setColorAt(
          i * 3 + aspect,
          colorScratch.setHex(OFF_COLORS[SIGNAL_COLORS[aspect]]),
        );
      }
    }
    bases.count = poles.count = backplates.count = housings.count = fixtures.length;
    hoods.count = offLenses.count = fixtures.length * 3;
    for (const mesh of batches) flush(mesh);
    if (offLenses.instanceColor) offLenses.instanceColor.needsUpdate = true;
    applySignals();
  }

  update(initialState, initialJunctions);
  return {
    group,
    update,
    setSignals(signals: readonly SignalState[]) {
      if (disposed) return;
      const next = new Map<string, SignalColor>();
      for (const signal of signals)
        if (SIGNAL_COLORS.includes(signal.color)) next.set(signal.approachId, signal.color);
      previousSignals = next;
      let changed = false;
      for (const fixture of fixtures) {
        const color = next.get(fixture.approachId) ?? 'red';
        if (color !== fixture.color) {
          fixture.color = color;
          changed = true;
        }
      }
      if (changed) applySignals();
    },
    getDebug() {
      return {
        count: fixtures.length,
        junctions: new Set(fixtures.map((fixture) => fixture.junctionId)).size,
        pointLights: 0,
        drawCalls: disposed ? 0 : batches.length,
        aspects: {
          red: fixtures.filter((fixture) => fixture.color === 'red').length,
          yellow: fixtures.filter((fixture) => fixture.color === 'yellow').length,
          green: fixtures.filter((fixture) => fixture.color === 'green').length,
        },
        positions: fixtures.slice(0, 128).map((fixture) => ({
          approachId: fixture.approachId,
          junctionId: fixture.junctionId,
          x: fixture.mast.x,
          y: fixture.mast.y,
          z: fixture.mast.z,
          headY: fixture.head.y,
          facing: { ...fixture.facing },
          color: fixture.color,
          stopBar: { x: fixture.stopBar.x, y: fixture.stopBar.y, z: fixture.stopBar.z },
        })),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of batches) mesh.dispose();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      fixtures = [];
      previousSignals.clear();
      group.clear();
      group.removeFromParent();
    },
  };
}
