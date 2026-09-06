import * as THREE from 'three';
import type { CityState, Tile } from '../../domain/types';
import {
  sampleFacilityAccessHeight,
  facilityWorldToLocal,
  type FacilityAccessPlan,
} from '../../buildings/facility-access';
import { getFacilityPavingMaterial } from './materials';
/** The visible foundation and driveway use the suspension's height sampler.
 * Moving only a lane overlay left the old plinth standing across a lower ramp. */
export function facilitySurfaceGeometry(
  plan: FacilityAccessPlan,
  tile: Tile,
  state: CityState,
  origin: {
    x: number;
    z: number;
  },
  u: {
    x: number;
    z: number;
  },
  v: {
    x: number;
    z: number;
  },
  step: number,
  verticalOffset = 0,
  sideDepth = 0,
): THREE.BufferGeometry {
  const nx = Math.max(1, Math.ceil(Math.hypot(u.x, u.z) / step));
  const nz = Math.max(1, Math.ceil(Math.hypot(v.x, v.z) / step));
  const rootX = tile.x - state.size / 2 + 0.5,
    rootZ = tile.z - state.size / 2 + 0.5;
  const positions: number[] = [],
    indices: number[] = [];
  const surfaceY = (x: number, z: number): number =>
    (sampleFacilityAccessHeight(plan, x + rootX, z + rootZ) ?? plan.baseY + 0.052) -
    plan.baseY +
    verticalOffset;
  for (let z = 0; z <= nz; z++)
    for (let x = 0; x <= nx; x++) {
      const wx = origin.x + (u.x * x) / nx + (v.x * z) / nz;
      const wz = origin.z + (u.z * x) / nx + (v.z * z) / nz;
      const y = sampleFacilityAccessHeight(plan, wx, wz) ?? plan.baseY + 0.052;
      positions.push(wx - rootX, y - plan.baseY + verticalOffset, wz - rootZ);
    }
  const forward = u.x * v.z - u.z * v.x > 0;
  type Midpoint = {
    x: number;
    y: number;
    z: number;
    index?: number;
  };
  const midpoints = new Map<string, Midpoint>();
  const midpoint = (a: number, b: number): Midpoint => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    let point = midpoints.get(key);
    if (!point) {
      const x = (positions[a * 3] + positions[b * 3]) / 2;
      const z = (positions[a * 3 + 2] + positions[b * 3 + 2]) / 2;
      point = { x, y: surfaceY(x, z), z };
      midpoints.set(key, point);
    }
    return point;
  };
  const vertex = (point: Midpoint): number => {
    if (point.index === undefined) {
      point.index = positions.length / 3;
      positions.push(point.x, point.y, point.z);
    }
    return point.index;
  };
  const triangle = (a: number, b: number, c: number, depth = 0): void => {
    const ab = midpoint(a, b),
      bc = midpoint(b, c),
      ca = midpoint(c, a);
    const ay = positions[a * 3 + 1],
      by = positions[b * 3 + 1],
      cy = positions[c * 3 + 1];
    const centerX = (positions[a * 3] + positions[b * 3] + positions[c * 3]) / 3;
    const centerZ = (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3;
    const error = Math.max(
      Math.abs(ab.y - (ay + by) / 2),
      Math.abs(bc.y - (by + cy) / 2),
      Math.abs(ca.y - (cy + ay) / 2),
      Math.abs(surfaceY(centerX, centerZ) - (ay + by + cy) / 3),
    );
    // Flat forecourts remain a coarse grid. Only curved slopes and shoulders
    // need extra vertices: matching grid vertices alone still bridged the
    // ramp's depression between them and put visible asphalt through tires.
    if (error > 0.0015 && depth < 4) {
      const iab = vertex(ab),
        ibc = vertex(bc),
        ica = vertex(ca);
      triangle(a, iab, ica, depth + 1);
      triangle(iab, b, ibc, depth + 1);
      triangle(ica, ibc, c, depth + 1);
      triangle(iab, ibc, ica, depth + 1);
    } else indices.push(a, b, c);
  };
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) {
      const a = z * (nx + 1) + x,
        b = a + 1,
        c = a + nx + 1,
        d = c + 1;
      if (forward) {
        triangle(a, c, b);
        triangle(b, c, d);
      } else {
        triangle(a, b, c);
        triangle(b, d, c);
      }
    }
  // The GPU stores Float32 coordinates. Sample their actual X/Z values too,
  // otherwise rounding at a tight bend can select a different ramp projection.
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = Math.fround(positions[i]);
    positions[i + 2] = Math.fround(positions[i + 2]);
    positions[i + 1] = surfaceY(positions[i], positions[i + 2]);
  }
  const surfaceVertexCount = positions.length / 3;
  if (sideDepth) {
    const perimeter: number[] = [];
    for (let x = 0; x <= nx; x++) perimeter.push(x);
    for (let z = 1; z <= nz; z++) perimeter.push(z * (nx + 1) + nx);
    for (let x = nx - 1; x >= 0; x--) perimeter.push(nz * (nx + 1) + x);
    for (let z = nz - 1; z > 0; z--) perimeter.push(z * (nx + 1));
    for (let i = 0; i < perimeter.length; i++) {
      const a = perimeter[i] * 3,
        b = perimeter[(i + 1) % perimeter.length] * 3,
        n = positions.length / 3;
      positions.push(
        ...positions.slice(a, a + 3),
        ...positions.slice(b, b + 3),
        positions[a],
        positions[a + 1] - sideDepth,
        positions[a + 2],
        positions[b],
        positions[b + 1] - sideDepth,
        positions[b + 2],
      );
      if (forward) indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
      else indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.userData.surfaceVertexCount = surfaceVertexCount;
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
export function connectFacilityModel(
  root: THREE.Group,
  frame: THREE.Group,
  plan: FacilityAccessPlan,
  tile: Tile,
  state: CityState,
): void {
  const content = new THREE.Group();
  content.name = 'facility-content';
  content.scale.set(plan.contentScale.x, 1, plan.contentScale.z);
  content.position.y = plan.kind === 'industrial' ? 0.027 : -0.031;
  content.position.z = plan.contentOffsetZ ?? 0;
  for (const child of [...frame.children]) {
    if (!(child instanceof THREE.Mesh) || !child.userData.facilityFoundation) {
      content.add(child);
      continue;
    }
    const top = child.userData.facilityFoundation === 'surface';
    const width = plan.width - (top ? 0.13 : 0.06),
      depth = plan.depth - (top ? 0.13 : 0.06);
    const geometry = facilitySurfaceGeometry(
      plan,
      tile,
      state,
      { x: plan.center.x - width / 2, z: plan.center.z - depth / 2 },
      { x: width, z: 0 },
      { x: 0, z: depth },
      0.15,
      top ? 0 : -0.01,
      top ? 0.01 : 0.04,
    );
    const surface = new THREE.Mesh(geometry, child.material);
    surface.name = `facility-foundation-${top ? 'surface' : 'base'}`;
    surface.userData.drivingSurface = true;
    surface.receiveShadow = true;
    root.add(surface);
    frame.remove(child);
  }
  frame.add(content);
  const facilityPavingMaterial = getFacilityPavingMaterial();
  // The four complete perimeter strips already include the routed section.
  // Add only the connector outside that ring, avoiding duplicate pavement.
  const rx = plan.localWidth / 2 - plan.laneWidth / 2,
    rz = plan.localDepth / 2 - plan.laneWidth / 2;
  for (const [index, segment] of plan.renderSegments.entries()) {
    if ((plan.kind !== 'industrial' || tile.lotWidth) && index >= 4) {
      const a = facilityWorldToLocal(plan, segment.a),
        b = facilityWorldToLocal(plan, segment.b);
      if ([a, b].every((p) => Math.abs(p.x) <= rx + 1e-7 && Math.abs(p.z) <= rz + 1e-7)) continue;
    }
    const dx = segment.b.x - segment.a.x,
      dz = segment.b.z - segment.a.z,
      length = Math.hypot(dx, dz);
    if (length < 1e-8) continue;
    const px = (-dz / length) * segment.width,
      pz = (dx / length) * segment.width;
    const geometry = facilitySurfaceGeometry(
      plan,
      tile,
      state,
      { x: segment.a.x - px / 2, z: segment.a.z - pz / 2 },
      { x: dx, z: dz },
      { x: px, z: pz },
      0.09,
    );
    const lane = new THREE.Mesh(geometry, facilityPavingMaterial);
    lane.name = 'facility-access-paving';
    lane.userData.drivingSurface = true;
    lane.receiveShadow = true;
    root.add(lane);
  }
}
