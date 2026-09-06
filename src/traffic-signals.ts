import * as THREE from 'three';
import { sampleRoadHeight } from './road-graphics';
import type { RoadJunction, TrafficApproach } from './traffic-network';
import { STOP_LINE_OFFSET, type SignalState } from './traffic-controller';
import type { CityState, Point } from './types';

type SignalColor = SignalState['color'];
const CURB_OFFSET = .465;
const HEAD_HEIGHT = .53;
const LENS_SPACING = .061;
const SIGNAL_COLORS = ['red', 'yellow', 'green'] as const;
const COLORS: Record<SignalColor, number> = { red: 0xff3027, yellow: 0xffbf23, green: 0x35ed75 };
const OFF_COLORS: Record<SignalColor, number> = { red: 0x381b1c, yellow: 0x39321b, green: 0x183527 };

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
export function getTrafficSignalFixture(state: CityState, approach: TrafficApproach): TrafficSignalFixture | null {
  const { from, entry, direction } = approach;
  if (![from.x, from.z, entry.x, entry.z, direction.x, direction.z].every(Number.isInteger)
    || Math.abs(direction.x) + Math.abs(direction.z) !== 1
    || entry.x - from.x !== direction.x || entry.z - from.z !== direction.z) return null;
  for (const point of [from, entry]) {
    if (point.x < 0 || point.z < 0 || point.x >= state.size || point.z >= state.size
      || state.tiles[point.z * state.size + point.x]?.kind !== 'road') return null;
  }
  const centerX = entry.x + .5 - state.size / 2, centerZ = entry.z + .5 - state.size / 2;
  const rightX = -direction.z, rightZ = direction.x;
  // The .67-wide asphalt leaves a .165-wide curb. Its outer corner also clears
  // the .405 pedestrian walking line and the centred facility driveway mouths.
  const x = centerX - direction.x * CURB_OFFSET + rightX * CURB_OFFSET;
  const z = centerZ - direction.z * CURB_OFFSET + rightZ * CURB_OFFSET;
  const ground = sampleRoadHeight(state, x, z);
  const stopOffset = STOP_LINE_OFFSET - .025;
  const stopX = centerX - direction.x * stopOffset + rightX * .17;
  const stopZ = centerZ - direction.z * stopOffset + rightZ * .17;
  return {
    approachId: approach.id, junctionId: approach.junctionId,
    mast: new THREE.Vector3(x, ground + .045, z),
    facing: { x: -direction.x, z: -direction.z },
    head: new THREE.Vector3(x, ground + HEAD_HEIGHT, z),
    stopBar: new THREE.Vector3(stopX, sampleRoadHeight(state, stopX, stopZ) + .0525, stopZ),
    mastRadius: .011, mastHeight: .495,
  };
}

interface Fixture extends TrafficSignalFixture { color: SignalColor; yaw: number; }

/**
 * Automatic curb-mounted three-aspect heads. The traffic controller is the only
 * source of signal colors: there is deliberately no animation clock here.
 * A fixed ten instanced draws, shared geometry, and no per-head real lights keep
 * large maps inexpensive. Unknown or newly created approaches default to red.
 */
export function createTrafficSignals(initialState: CityState, initialJunctions: readonly RoadJunction[]) {
  const group = new THREE.Group();
  group.name = 'traffic-signals';
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(.5, .5, 1, 10);
  const hood = new THREE.CylinderGeometry(.5, .5, 1, 12, 1, true);
  hood.rotateX(Math.PI / 2);
  const lens = new THREE.CircleGeometry(.5, 12);
  const paintTriangle = new THREE.BufferGeometry();
  paintTriangle.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1, 1, 0, 0], 3));
  paintTriangle.computeVertexNormals();
  const geometries = [box, cylinder, hood, lens, paintTriangle];
  const metal = new THREE.MeshStandardMaterial({ color: 0x56646b, roughness: .5, metalness: .65 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x89918b, roughness: .9 });
  const housing = new THREE.MeshStandardMaterial({ color: 0x182329, roughness: .7, metalness: .2 });
  const offLens = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .32, metalness: .1 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xf0eee3, roughness: .95 });
  const litMaterials = Object.fromEntries(SIGNAL_COLORS.map(color => [color,
    new THREE.MeshStandardMaterial({ color: COLORS[color], emissive: COLORS[color], emissiveIntensity: 1.8,
      roughness: .28, toneMapped: false }),
  ])) as Record<SignalColor, THREE.MeshStandardMaterial>;
  const materials = [metal, concrete, housing, offLens, paint, ...Object.values(litMaterials)];
  const transform = new THREE.Object3D(), matrix = new THREE.Matrix4(), colorScratch = new THREE.Color();
  let capacity = 0, signature = '', disposed = false;
  let fixtures: Fixture[] = [];
  let batches: THREE.InstancedMesh[] = [];
  let bases: THREE.InstancedMesh, poles: THREE.InstancedMesh, backplates: THREE.InstancedMesh;
  let housings: THREE.InstancedMesh, hoods: THREE.InstancedMesh, offLenses: THREE.InstancedMesh, stopBars: THREE.InstancedMesh;
  let litLenses: Record<SignalColor, THREE.InstancedMesh>;
  let previousSignals = new Map<string, SignalColor>();

  function batch(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, multiplier = 1) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity * multiplier);
    mesh.name = `traffic-signal-${name}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.drivingObstacle = false;
    group.add(mesh); batches.push(mesh);
    return mesh;
  }

  function ensureCapacity(count: number) {
    if (count <= capacity) return;
    for (const mesh of batches) { group.remove(mesh); mesh.dispose(); }
    batches = [];
    capacity = Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(1, count))));
    bases = batch('bases', cylinder, concrete);
    poles = batch('poles', cylinder, metal);
    bases.userData.drivingObstacle = poles.userData.drivingObstacle = true;
    backplates = batch('backplates', box, housing);
    housings = batch('housings', box, housing);
    hoods = batch('hoods', hood, housing, 3);
    offLenses = batch('off-lenses', lens, offLens, 3);
    stopBars = batch('stop-bars', paintTriangle, paint, 4);
    stopBars.castShadow = false;
    litLenses = Object.fromEntries(SIGNAL_COLORS.map(color => [color, batch(`${color}-lenses`, lens, litMaterials[color])])) as Record<SignalColor, THREE.InstancedMesh>;
    for (const mesh of [offLenses, ...Object.values(litLenses)]) mesh.castShadow = mesh.receiveShadow = false;
  }

  function place(mesh: THREE.InstancedMesh, index: number, fixture: Fixture, height: number, forward: number, sx: number, sy: number, sz: number) {
    transform.position.set(fixture.head.x + fixture.facing.x * forward, fixture.head.y + height, fixture.head.z + fixture.facing.z * forward);
    transform.rotation.set(0, fixture.yaw, 0);
    transform.scale.set(sx, sy, sz);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  }

  function flush(mesh: THREE.InstancedMesh) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
  }

  function applySignals() {
    for (const mesh of Object.values(litLenses)) mesh.count = 0;
    for (const fixture of fixtures) {
      const index = SIGNAL_COLORS.indexOf(fixture.color), mesh = litLenses[fixture.color];
      place(mesh, mesh.count++, fixture, (1 - index) * LENS_SPACING, .033, .047, .047, 1);
    }
    for (const mesh of Object.values(litLenses)) flush(mesh);
  }

  function placeStopBar(state: CityState, fixture: Fixture) {
    const { x, z } = fixture.stopBar, facing = fixture.facing;
    const rightX = facing.z, rightZ = -facing.x;
    const corners = [[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([r, f]) => ({
      x: x + rightX * r * .135 + facing.x * f * .015,
      z: z + rightZ * r * .135 + facing.z * f * .015,
    }));
    // This bar lies in the incoming tile. Split its rectangle at the exact road
    // diagonal; a truck-safe setback can put the painted line across that seam.
    const diagonal = Math.floor(x + state.size / 2) - Math.floor(z + state.size / 2);
    const distance = (p: Point) => p.x - p.z - diagonal;
    for (const sign of [-1, 1]) {
      const clipped: Point[] = [];
      for (let i = 0; i < corners.length; i++) {
        const a = corners[i], b = corners[(i + 1) % corners.length];
        const da = distance(a), db = distance(b);
        const insideA = sign * da >= -1e-10, insideB = sign * db >= -1e-10;
        if (insideA) clipped.push(a);
        if (insideA !== insideB) {
          const t = da / (da - db);
          clipped.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
        }
      }
      const points = clipped.filter((p, i) => i === 0 || Math.hypot(p.x - clipped[i - 1].x, p.z - clipped[i - 1].z) > 1e-9);
      if (points.length > 1 && Math.hypot(points[0].x - points[points.length - 1].x, points[0].z - points[points.length - 1].z) < 1e-9) points.pop();
      for (let i = 1; i < points.length - 1; i++) {
        const a = points[0], b = points[i], c = points[i + 1];
        const ay = sampleRoadHeight(state, a.x, a.z) + .0525;
        const by = sampleRoadHeight(state, b.x, b.z) + .0525;
        const cy = sampleRoadHeight(state, c.x, c.z) + .0525;
        matrix.set(c.x - a.x, 0, b.x - a.x, a.x, cy - ay, 1, by - ay, ay,
          c.z - a.z, 0, b.z - a.z, a.z, 0, 0, 0, 1);
        stopBars.setMatrixAt(stopBars.count++, matrix);
      }
    }
  }

  function update(state: CityState, junctions: readonly RoadJunction[]) {
    if (disposed) return;
    // Neighbouring road and rail heights participate in the shared road corners.
    let checksum = 2166136261;
    for (const tile of state.tiles) if (tile.kind === 'road' || tile.kind === 'rail') {
      checksum = Math.imul(checksum ^ (tile.z * state.size + tile.x), 16777619);
      checksum = Math.imul(checksum ^ Math.round(tile.elevation * 65536), 16777619);
      checksum = Math.imul(checksum ^ (tile.kind === 'road' ? 1 : 2), 16777619);
    }
    const approaches = junctions.filter(junction => junction.signalized !== false).flatMap(junction => junction.approaches);
    const nextSignature = `${state.size}:${checksum >>> 0}:` + approaches.map(a => `${a.id}/${a.junctionId}/${a.from.x},${a.from.z}/${a.entry.x},${a.entry.z}/${a.direction.x},${a.direction.z}`).join(';');
    if (signature === nextSignature) return;
    signature = nextSignature;
    const seen = new Set<string>();
    fixtures = [];
    for (const approach of approaches) {
      if (seen.has(approach.id)) continue;
      seen.add(approach.id);
      const fixture = getTrafficSignalFixture(state, approach);
      if (fixture) fixtures.push({ ...fixture, color: previousSignals.get(approach.id) ?? 'red', yaw: Math.atan2(fixture.facing.x, fixture.facing.z) });
    }
    ensureCapacity(Math.max(1, fixtures.length));
    stopBars.count = 0;
    for (let i = 0; i < fixtures.length; i++) {
      const fixture = fixtures[i], ground = fixture.mast.y - .045;
      place(bases, i, fixture, ground + .035 - fixture.head.y, 0, .055, .028, .055);
      place(poles, i, fixture, fixture.mast.y + fixture.mastHeight / 2 - fixture.head.y, 0, .022, fixture.mastHeight, .022);
      place(backplates, i, fixture, 0, -.028, .097, .246, .013);
      place(housings, i, fixture, 0, 0, .077, .22, .05);
      for (let aspect = 0; aspect < 3; aspect++) {
        const height = (1 - aspect) * LENS_SPACING;
        place(hoods, i * 3 + aspect, fixture, height, .037, .058, .058, .03);
        place(offLenses, i * 3 + aspect, fixture, height, .031, .047, .047, 1);
        offLenses.setColorAt(i * 3 + aspect, colorScratch.setHex(OFF_COLORS[SIGNAL_COLORS[aspect]]));
      }
      placeStopBar(state, fixture);
    }
    bases.count = poles.count = backplates.count = housings.count = fixtures.length;
    hoods.count = offLenses.count = fixtures.length * 3;
    for (const mesh of batches) flush(mesh);
    if (offLenses.instanceColor) offLenses.instanceColor.needsUpdate = true;
    applySignals();
  }

  update(initialState, initialJunctions);
  return {
    group, update,
    setSignals(signals: readonly SignalState[]) {
      if (disposed) return;
      const next = new Map<string, SignalColor>();
      for (const signal of signals) if (SIGNAL_COLORS.includes(signal.color)) next.set(signal.approachId, signal.color);
      previousSignals = next;
      let changed = false;
      for (const fixture of fixtures) {
        const color = next.get(fixture.approachId) ?? 'red';
        if (color !== fixture.color) { fixture.color = color; changed = true; }
      }
      if (changed) applySignals();
    },
    getDebug() {
      return { count: fixtures.length, junctions: new Set(fixtures.map(fixture => fixture.junctionId)).size,
        pointLights: 0, drawCalls: disposed ? 0 : batches.length,
        aspects: { red: fixtures.filter(fixture => fixture.color === 'red').length,
          yellow: fixtures.filter(fixture => fixture.color === 'yellow').length,
          green: fixtures.filter(fixture => fixture.color === 'green').length },
        positions: fixtures.slice(0, 128).map(fixture => ({ approachId: fixture.approachId, junctionId: fixture.junctionId,
          x: fixture.mast.x, y: fixture.mast.y, z: fixture.mast.z, headY: fixture.head.y,
          facing: { ...fixture.facing }, color: fixture.color,
          stopBar: { x: fixture.stopBar.x, y: fixture.stopBar.y, z: fixture.stopBar.z } })),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of batches) mesh.dispose();
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      fixtures = []; previousSignals.clear();
      group.clear(); group.removeFromParent();
    },
  };
}
