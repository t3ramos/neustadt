import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type VehicleKind = 'sedan' | 'taxi' | 'van' | 'truck';
type Part = 'paint' | 'windows' | 'tires-and-trim' | 'rims-and-metal' | 'headlights' | 'taillights' | 'cargo-and-details';
type Vec = readonly [number, number, number];
type Section = readonly [z: number, halfWidth: number, bottom: number, top: number, bevel: number];
const parts: Part[] = ['paint', 'windows', 'tires-and-trim', 'rims-and-metal', 'headlights', 'taillights', 'cargo-and-details'];
const paintMaterials = new Map<number, THREE.MeshPhysicalMaterial>();
const sharedGeometry = new Map<VehicleKind, Partial<Record<Part, THREE.BufferGeometry>>>();
const materials: Record<Exclude<Part, 'paint'>, THREE.MeshStandardMaterial> = {
  windows: new THREE.MeshPhysicalMaterial({ color: 0x244a57, metalness: .12, roughness: .075, clearcoat: 1, clearcoatRoughness: .055 }),
  'tires-and-trim': new THREE.MeshStandardMaterial({ color: 0x222a2c, metalness: .03, roughness: .88 }),
  'rims-and-metal': new THREE.MeshStandardMaterial({ color: 0xa7b7bb, metalness: .78, roughness: .24 }),
  headlights: new THREE.MeshStandardMaterial({ color: 0xfff2ca, emissive: 0xffe4a8, emissiveIntensity: .65, metalness: .12, roughness: .16 }),
  taillights: new THREE.MeshStandardMaterial({ color: 0xc44339, emissive: 0xc71910, emissiveIntensity: .55, metalness: .1, roughness: .23 }),
  'cargo-and-details': new THREE.MeshStandardMaterial({ color: 0xbeb39b, roughness: .75, metalness: .04 }),
};
for (const [name, material] of Object.entries(materials)) material.name = `vehicle-${name}`;
function painted(color: number): THREE.MeshPhysicalMaterial {
  const normalized = new THREE.Color(color).getHex();
  let material = paintMaterials.get(normalized);
  if (!material) {
    material = new THREE.MeshPhysicalMaterial({ color: normalized, metalness: .32, roughness: .21, clearcoat: 1, clearcoatRoughness: .12 });
    material.name = `vehicle-paint-${normalized.toString(16).padStart(6, '0')}`;
    paintMaterials.set(normalized, material);
  }
  return material;
}

/** Rounded shoulder sections form a smooth, genuinely contoured painted shell. */
function beveledLoft(sections: readonly Section[]): THREE.BufferGeometry {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const ringSize = 16;
  for (const [z, width, bottom, top, wantedBevel] of sections) {
    const bevel = Math.min(wantedBevel, width * .45, (top - bottom) * .45);
    const corners = [[width - bevel, bottom + bevel, -Math.PI / 2], [width - bevel, top - bevel, 0], [-width + bevel, top - bevel, Math.PI / 2], [-width + bevel, bottom + bevel, Math.PI]];
    for (const [cx, cy, angle] of corners) for (let segment = 0; segment <= 3; segment++) {
      const theta = angle + segment * Math.PI / 6;
      const x = cx + Math.cos(theta) * bevel, y = cy + Math.sin(theta) * bevel;
      positions.push(x, y, z); uv.push(x / .24 + .5, z / .58 + .5);
    }
  }
  for (let section = 0; section < sections.length - 1; section++) for (let edge = 0; edge < ringSize; edge++) {
    const a = section * ringSize + edge, b = section * ringSize + (edge + 1) % ringSize, c = (section + 1) * ringSize + (edge + 1) % ringSize, d = (section + 1) * ringSize + edge;
    indices.push(a, b, d, b, c, d);
  }
  for (let i = 1; i < ringSize - 1; i++) {
    indices.push(0, i + 1, i);
    const end = (sections.length - 1) * ringSize;
    indices.push(end, end + i, end + i + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

/** Cut actual circular wheel clearances into the lower painted silhouette. */
function archedBody(sections: readonly Section[], axles: readonly number[], wheelY: number, radius: number): THREE.BufferGeometry {
  const stops = new Set(sections.map(s => s[0]));
  for (const axle of axles) for (let i = 0; i <= 8; i++) stops.add(axle + Math.cos(i / 8 * Math.PI) * (radius + .004));
  const profile = [...stops].filter(z => z >= sections[0][0] && z <= sections[sections.length - 1][0]).sort((a, b) => a - b).map(z => {
    const index = Math.max(0, sections.findIndex((section, i) => i < sections.length - 1 && z >= section[0] && z <= sections[i + 1][0]));
    const a = sections[index], b = sections[index + 1];
    const t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
    const values = a.map((value, i) => THREE.MathUtils.lerp(value, b[i], t));
    let bottom = values[2];
    for (const axle of axles) {
      const delta = Math.abs(z - axle), archRadius = radius + .004;
      if (delta < archRadius) bottom = Math.max(bottom, wheelY + Math.sqrt(archRadius * archRadius - delta * delta));
    }
    return [z, values[1], Math.min(bottom, values[3] - .014), values[3], values[4]] as Section;
  });
  return beveledLoft(profile);
}

function quad(a: Vec, b: Vec, c: Vec, d: Vec): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals();
  return geometry;
}

class VehicleBuilder {
  private buckets: Record<Part, THREE.BufferGeometry[]> = { paint: [], windows: [], 'tires-and-trim': [], 'rims-and-metal': [], headlights: [], taillights: [], 'cargo-and-details': [] };
  add(part: Part, geometry: THREE.BufferGeometry): void {
    const plain = geometry.index ? geometry.toNonIndexed() : geometry;
    if (plain !== geometry) geometry.dispose();
    plain.clearGroups(); this.buckets[part].push(plain);
  }
  box(part: Part, x: number, y: number, z: number, w: number, h: number, d: number, rotationY = 0): void {
    this.add(part, new THREE.BoxGeometry(w, h, d).rotateY(rotationY).translate(x, y, z));
  }
  cylinder(part: Part, x: number, y: number, z: number, radius: number, length: number, segments: number, axis: 'x' | 'y' | 'z' = 'y'): void {
    const geometry = new THREE.CylinderGeometry(radius, radius, length, segments);
    if (axis === 'x') geometry.rotateZ(Math.PI / 2);
    if (axis === 'z') geometry.rotateX(Math.PI / 2);
    this.add(part, geometry.translate(x, y, z));
  }
  finish(kind: VehicleKind): Partial<Record<Part, THREE.BufferGeometry>> {
    const result: Partial<Record<Part, THREE.BufferGeometry>> = {};
    for (const part of parts) {
      if (!this.buckets[part].length) continue;
      const geometry = mergeGeometries(this.buckets[part], false);
      for (const source of this.buckets[part]) source.dispose();
      if (!geometry) throw new Error(`Vehicle geometry failed: ${kind}/${part}`);
      geometry.name = `vehicle-${kind}-${part}-shared`; geometry.userData.shared = true;
      geometry.computeBoundingBox(); geometry.computeBoundingSphere(); result[part] = geometry;
    }
    return result;
  }
}

function wheel(b: VehicleBuilder, side: number, x: number, y: number, z: number, radius: number, width: number, segments = 32): void {
  // The cross-section rounds over the shoulders. It is visibly different from
  // a higher-segment straight cylinder when viewed along the hood or fender.
  const profile = segments === 24 ? [
    new THREE.Vector2(radius * .73, -width / 2), new THREE.Vector2(radius * .97, -width * .27),
    new THREE.Vector2(radius, 0), new THREE.Vector2(radius * .97, width * .27), new THREE.Vector2(radius * .73, width / 2),
  ] : [
    new THREE.Vector2(radius * .73, -width / 2), new THREE.Vector2(radius * .93, -width * .37),
    new THREE.Vector2(radius, -width * .13), new THREE.Vector2(radius, width * .13),
    new THREE.Vector2(radius * .93, width * .37), new THREE.Vector2(radius * .73, width / 2),
  ];
  const tire = new THREE.LatheGeometry(profile, segments);
  b.add('tires-and-trim', tire.rotateZ(Math.PI / 2).translate(side * x, y, z));
  const face = x + width / 2 - .0016;
  b.cylinder('tires-and-trim', side * face, y, z, radius * .68, .0012, 16, 'x');
  const rim = new THREE.TorusGeometry(radius * .64, .002, 3, segments);
  b.add('rims-and-metal', rim.rotateY(Math.PI / 2).translate(side * (face + .0002679492), y, z));
  b.cylinder('rims-and-metal', side * (face + .001), y, z, radius * .20, .001, 12, 'x');
  for (let spoke = 0; spoke < 5; spoke++) {
    const angle = spoke * Math.PI * 2 / 5, dy = Math.cos(angle), dz = Math.sin(angle);
    const cy = y + dy * radius * .36, cz = z + dz * radius * .36, length = radius * .24, half = radius * .06;
    const points: Vec[] = [
      [side * (face + .001), cy - dy * length + dz * half, cz - dz * length - dy * half],
      [side * (face + .001), cy + dy * length + dz * half, cz + dz * length - dy * half],
      [side * (face + .001), cy + dy * length - dz * half, cz + dz * length + dy * half],
      [side * (face + .001), cy - dy * length - dz * half, cz - dz * length + dy * half],
    ];
    if (side < 0) points.reverse();
    b.add('rims-and-metal', quad(points[0], points[1], points[2], points[3]));
  }
  // Subtle molded tread ribs and an outer wheel-arch lip give close views
  // mechanical detail without additional materials or draw calls.
  const ribs = segments === 24 ? 4 : 8;
  for (let rib = 0; rib < ribs; rib++) {
    const angle = rib * Math.PI * 2 / ribs;
    const geometry = new THREE.BoxGeometry(width * .16, .0012, .003);
    geometry.rotateX(angle).translate(side * x, y + Math.cos(angle) * (radius - .0007), z + Math.sin(angle) * (radius - .0007));
    b.add('tires-and-trim', geometry);
  }
  const arch = new THREE.TorusGeometry(radius + .0043, .0018, 3, 12, Math.PI);
  b.add('paint', arch.rotateY(Math.PI / 2).translate(side * (x - width * .16), y, z));
}

const sedanCabin = [
  { z: -.092, bottomWidth: .069, topWidth: .067, top: .101 },
  { z: -.045, bottomWidth: .071, topWidth: .056, top: .155 },
  { z: .029, bottomWidth: .071, topWidth: .056, top: .157 },
  { z: .079, bottomWidth: .068, topWidth: .066, top: .101 },
];
function cabinAt(z: number): { top: number; topWidth: number; bottomWidth: number } {
  const i = Math.min(sedanCabin.length - 2, Math.max(0, sedanCabin.findIndex((section, n) => n < sedanCabin.length - 1 && z <= sedanCabin[n + 1].z)));
  const a = sedanCabin[i], b = sedanCabin[i + 1], t = THREE.MathUtils.clamp((z - a.z) / (b.z - a.z), 0, 1);
  return { top: THREE.MathUtils.lerp(a.top, b.top, t), topWidth: THREE.MathUtils.lerp(a.topWidth, b.topWidth, t), bottomWidth: THREE.MathUtils.lerp(a.bottomWidth, b.bottomWidth, t) };
}
function sedanSide(side: number, z: number, y: number): Vec {
  const section = cabinAt(z);
  const x = THREE.MathUtils.lerp(section.bottomWidth, section.topWidth, (y - .096) / (section.top - .096));
  return [side * (x + .0015), y, z];
}
function frontDetails(b: VehicleBuilder, front: number, rear: number, halfWidth: number, hoodY: number, scale = 1): void {
  b.box('tires-and-trim', 0, hoodY - .021 * scale, front - .004, halfWidth * 1.2, .019 * scale, .01);
  for (let row = 0; row < 4; row++) b.box('rims-and-metal', 0, hoodY - .027 * scale + row * .0042 * scale, front + .001, halfWidth * 1.04, .0015, .0018);
  b.box('rims-and-metal', 0, hoodY - .045 * scale, front - .004, halfWidth * 1.58, .005, .008);
  b.box('tires-and-trim', 0, hoodY - .039 * scale, rear + .004, halfWidth * 1.5, .013, .01);
  b.box('cargo-and-details', 0, hoodY - .039 * scale, front + .004, .027 * scale, .008 * scale, .002);
  b.box('cargo-and-details', 0, hoodY - .029 * scale, rear - .003, .027 * scale, .008 * scale, .002);
  for (const side of [-1, 1]) {
    b.box('headlights', side * halfWidth * .63, hoodY, front + .004, halfWidth * .37, .011 * scale, .011);
    b.box('taillights', side * halfWidth * .64, hoodY, rear - .004, halfWidth * .40, .013 * scale, .010);
    b.box('headlights', side * halfWidth * .70, hoodY - .024 * scale, front + .002, .013, .004, .004);
    // Dark lens dividers, reflectors and a high brake strip stay separate from paint.
    b.box('tires-and-trim', side * halfWidth * .64, hoodY + .003, rear - .0082, .0014, .011 * scale, .001);
  }
}

function sedan(b: VehicleBuilder, taxi: boolean): void {
  b.add('paint', archedBody([
    [-.160, .055, .043, .070, .007], [-.150, .073, .032, .087, .010],
    [-.114, .080, .0285, .098, .010], [-.043, .080, .029, .100, .010],
    [.066, .080, .029, .098, .011], [.128, .077, .032, .091, .011],
    [.151, .068, .039, .081, .009], [.160, .053, .047, .070, .005],
  ], [-.105, .105], .039, .026));
  b.box('tires-and-trim', 0, .041, 0, .094, .020, .254);
  for (let i = 0; i < sedanCabin.length - 1; i++) {
    const a = sedanCabin[i], c = sedanCabin[i + 1];
    b.add('paint', quad([-a.topWidth, a.top, a.z], [-c.topWidth, c.top, c.z], [c.topWidth, c.top, c.z], [a.topWidth, a.top, a.z]));
    for (const side of [-1, 1]) {
      const points: Vec[] = [[side * a.bottomWidth, .096, a.z], [side * a.topWidth, a.top, a.z], [side * c.topWidth, c.top, c.z], [side * c.bottomWidth, .096, c.z]];
      if (side < 0) points.reverse(); b.add('paint', quad(points[0], points[1], points[2], points[3]));
    }
  }
  b.add('paint', beveledLoft([
    [-.047, .055, .152, .157, .0018], [-.036, .058, .154, .161, .0026],
    [.016, .058, .155, .163, .0026], [.031, .055, .153, .159, .002],
  ]));
  for (const [backZ, frontZ] of [[.033, .074], [-.086, -.050]]) {
    const a = cabinAt(backZ), c = cabinAt(frontZ);
    b.add('windows', quad([-a.topWidth + .004, a.top + .0008, backZ], [-c.topWidth + .004, c.top + .0008, frontZ], [c.topWidth - .004, c.top + .0008, frontZ], [a.topWidth - .004, a.top + .0008, backZ]));
  }
  for (const side of [-1, 1]) {
    const panes = [
      [sedanSide(side, -.012, .104), sedanSide(side, -.012, .150), sedanSide(side, .025, .150), sedanSide(side, .067, .104)],
      [sedanSide(side, -.076, .104), sedanSide(side, -.043, .148), sedanSide(side, -.019, .149), sedanSide(side, -.019, .104)],
    ];
    for (const points of panes) { if (side < 0) points.reverse(); b.add('windows', quad(points[0], points[1], points[2], points[3])); }
    b.box('paint', side * .0839, .112, .046, .013, .010, .018, side * -.12);
    b.box('windows', side * .086, .112, .037, .010, .006, .002);
    for (const z of [-.001, -.055]) b.box('rims-and-metal', side * .0788, .093, z, .002, .004, .014);
    b.box('tires-and-trim', side * .0801, .071, -.018, .0012, .042, .0015);
    b.box('tires-and-trim', side * .077, .045, -.001, .009, .010, .17);
    b.box('rims-and-metal', side * .0795, .052, -.001, .002, .0028, .168);
    for (const z of [-.105, .105]) wheel(b, side, .079, .039, z, .026, .0242);
    if (taxi) for (let i = 0; i < 8; i++) b.box('tires-and-trim', side * .0806, .087, -.06 + i * .015, .0014, .006, .009);
  }
  frontDetails(b, .16, -.16, .076, .078);
  b.box('taillights', 0, .118, -.078, .049, .003, .002);
  for (const x of [-.027, .027]) b.box('tires-and-trim', x, .1105, .071, .035, .0018, .002, x < 0 ? -.12 : .12);
  if (taxi) {
    b.box('rims-and-metal', 0, .168, -.008, .033, .011, .015);
    b.add('cargo-and-details', beveledLoft([[-.026, .031, .171, .188, .003], [.005, .029, .171, .188, .003]]));
    // A compact readable TAXI-style mark, plus the conventional checker band.
    for (const x of [-.019, -.006, .008, .020]) b.box('tires-and-trim', x, .181, .006, .006, .008, .0015);
    b.box('cargo-and-details', 0, .182, -.027, .043, .005, .001);
  }
}

function commercialCab(b: VehicleBuilder, rear: number, windTop: number, windBottom: number, halfWidth: number, topWidth: number, floor: number, roof: number): void {
  const sections: Section[] = [
    [rear, halfWidth - .007, floor, roof - .005, .010],
    [rear + .014, halfWidth, floor, roof, .012],
    [windTop, halfWidth, floor, roof - .004, .009],
    [windBottom, halfWidth - .005, floor, floor + .024, .008],
  ];
  b.add('paint', beveledLoft(sections));
  const at = (z: number) => {
    const i = Math.max(0, sections.findIndex((s, n) => n < sections.length - 1 && z >= s[0] && z <= sections[n + 1][0]));
    const a = sections[i], c = sections[i + 1], t = THREE.MathUtils.clamp((z - a[0]) / (c[0] - a[0]), 0, 1);
    return a.map((value, n) => THREE.MathUtils.lerp(value, c[n], t));
  };
  const topZ = windTop + .004, bottomZ = windBottom - .004;
  const yTop = at(topZ)[3] + .0013, yBottom = at(bottomZ)[3] + .0013;
  b.add('windows', quad([-topWidth, yTop, topZ], [-halfWidth + .015, yBottom, bottomZ], [halfWidth - .015, yBottom, bottomZ], [topWidth, yTop, topZ]));
  for (const side of [-1, 1]) {
    // Follow the curved painted shoulder with a subdivided glass surface.
    // Corner-only quads can dip underneath a rounded cabin at their centre.
    const bottomRear: Vec = [0, floor + .019, rear + .013], topRear: Vec = [0, roof - .017, rear + .018];
    const topFront: Vec = [0, roof - .020, windTop - .004], bottomFront: Vec = [0, floor + .036, windBottom - .012];
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    const nu = 4, nv = 3;
    for (let uIndex = 0; uIndex <= nu; uIndex++) for (let vIndex = 0; vIndex <= nv; vIndex++) {
      const u = uIndex / nu, v = vIndex / nv;
      const y = THREE.MathUtils.lerp(THREE.MathUtils.lerp(bottomRear[1], bottomFront[1], u), THREE.MathUtils.lerp(topRear[1], topFront[1], u), v);
      const z = THREE.MathUtils.lerp(THREE.MathUtils.lerp(bottomRear[2], bottomFront[2], u), THREE.MathUtils.lerp(topRear[2], topFront[2], u), v);
      const section = at(z), w = section[1], top = section[3], radius = Math.min(section[4], (top - floor) * .45);
      const dy = Math.max(0, y - (top - radius));
      const x = dy > 0 ? w - radius + Math.sqrt(Math.max(0, radius * radius - dy * dy)) : w;
      positions.push(side * (x + .0016), y, z); uvs.push(u, v);
    }
    for (let u = 0; u < nu; u++) for (let v = 0; v < nv; v++) {
      const a = u * (nv + 1) + v, c = (u + 1) * (nv + 1) + v, d = c + 1, e = a + 1;
      if (side > 0) indices.push(a, e, c, e, d, c); else indices.push(a, c, e, e, c, d);
    }
    const pane = new THREE.BufferGeometry(); pane.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); pane.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); pane.setIndex(indices); pane.computeVertexNormals(); b.add('windows', pane);
    b.box('paint', side * (halfWidth + .016), floor + .057, windBottom - .025, .014, .020, .025);
    b.box('windows', side * (halfWidth + .020), floor + .057, windBottom - .039, .009, .014, .002);
    b.box('rims-and-metal', side * (halfWidth + .0015), floor + .010, rear + .035, .002, .004, .018);
  }
  for (const x of [-.030, .030]) b.box('tires-and-trim', x, yBottom + .003, bottomZ, .038, .0018, .002, x < 0 ? -.10 : .10);
}

function van(b: VehicleBuilder): void {
  b.add('paint', archedBody([
    [-.181, .073, .042, .111, .013], [-.169, .088, .033, .115, .012],
    [-.110, .089, .029, .115, .012], [.083, .089, .030, .118, .011],
    [.157, .083, .040, .107, .012], [.185, .067, .048, .090, .010],
  ], [-.124, .125], .043, .030));
  b.add('paint', beveledLoft([[-.177, .077, .105, .218, .013], [-.157, .086, .105, .227, .014], [.045, .086, .105, .227, .014], [.059, .082, .105, .219, .013]]));
  commercialCab(b, .044, .089, .150, .084, .070, .107, .223);
  b.box('tires-and-trim', 0, .046, 0, .110, .023, .31);
  for (const side of [-1, 1]) {
    for (const z of [-.124, .125]) wheel(b, side, .088, .043, z, .030, .027, 32);
    // Sliding-door rail, recessed door seam and a commercial cargo badge.
    b.box('rims-and-metal', side * .0869, .152, -.071, .0014, .003, .178);
    for (const z of [-.154, .011]) b.box('tires-and-trim', side * .0872, .159, z, .0014, .094, .0014);
    b.box('cargo-and-details', side * .0874, .185, -.067, .0016, .024, .074);
    b.box('rims-and-metal', side * .0882, .137, .004, .0015, .004, .019);
  }
  b.box('tires-and-trim', 0, .163, -.181, .002, .109, .003);
  for (const side of [-1, 1]) {
    b.box('cargo-and-details', side * .043, .177, -.180, .065, .075, .003);
    b.box('rims-and-metal', side * .015, .144, -.183, .004, .026, .002);
    b.box('taillights', side * .070, .125, -.184, .012, .043, .010);
  }
  frontDetails(b, .185, -.180, .084, .091, 1.05);
}

function truck(b: VehicleBuilder): void {
  b.box('tires-and-trim', 0, .066, -.02, .112, .032, .512);
  for (const x of [-.040, .040]) b.box('rims-and-metal', x, .067, -.02, .018, .020, .518);
  b.add('paint', archedBody([
    [.078, .080, .066, .149, .014], [.094, .098, .048, .153, .012],
    [.181, .098, .042, .152, .014], [.239, .089, .051, .134, .014], [.275, .075, .064, .111, .010],
  ], [.184], .049, .036));
  commercialCab(b, .084, .194, .257, .094, .079, .135, .259);
  // An open flatbed is separate from the cab and can be inspected from above.
  b.box('rims-and-metal', 0, .101, -.100, .205, .024, .350);
  for (let plank = 0; plank < 8; plank++) b.box('cargo-and-details', -.079 + plank * .0225, .118, -.100, .021, .013, .335);
  for (const side of [-1, 1]) {
    b.box('paint', side * .104, .158, -.1, .012, .073, .354);
    b.box('rims-and-metal', side * .1098, .201, -.1, .008, .006, .354);
    for (const z of [-.237, -.13, -.023]) b.box('rims-and-metal', side * .111, .162, z, .002, .076, .012);
    for (const z of [-.190, -.115, .184]) wheel(b, side, .096, .049, z, .036, .031, 24);
    b.box('tires-and-trim', side * .098, .054, -.232, .030, .058, .004);
    b.box('rims-and-metal', side * .083, .102, .246, .018, .007, .070);
    b.box('rims-and-metal', side * .080, .082, .215, .027, .006, .063);
    b.box('cargo-and-details', side * .103, .124, -.23, .009, .004, .008);
  }
  b.box('paint', 0, .158, -.274, .212, .073, .012);
  b.box('paint', 0, .168, .072, .212, .099, .012);
  for (const x of [-.071, .071]) {
    b.box('rims-and-metal', x, .166, -.281, .010, .045, .003);
    b.box('rims-and-metal', x, .203, -.276, .024, .004, .012);
  }
  // Two small parcels leave a visibly open central cargo floor and distinguish
  // the vehicle from the high opaque body of an ambulance or delivery van.
  for (const x of [-.056, .056]) {
    b.box('cargo-and-details', x, .145, -.206, .053, .043, .075);
    b.box('tires-and-trim', x, .167, -.206, .005, .001, .076);
  }
  frontDetails(b, .277, -.279, .094, .118, 1.20);
  // Large practical grille, not a light bar or emergency vehicle marking.
  for (let slot = 0; slot < 7; slot++) b.box('tires-and-trim', -.050 + slot * .0167, .134, .268, .009, .025, .003);
}

function buildSharedGeometry(kind: VehicleKind): Partial<Record<Part, THREE.BufferGeometry>> {
  const b = new VehicleBuilder();
  if (kind === 'sedan' || kind === 'taxi') sedan(b, kind === 'taxi');
  else if (kind === 'van') van(b);
  else truck(b);
  return b.finish(kind);
}

const labels: Record<VehicleKind, string> = { sedan: 'Limousine', taxi: 'Taxi', van: 'Transporter', truck: 'Lastwagen' };
const dynamics: Record<VehicleKind, { wheelBase: number; mass: number }> = { sedan: { wheelBase: .21, mass: 1 }, taxi: { wheelBase: .21, mass: 1 }, van: { wheelBase: .249, mass: 1.4 }, truck: { wheelBase: .3365, mass: 2.5 } };

/** All four genuinely different body types share at most seven GPU batches. */
export function createDetailedCar(color: number, kind: VehicleKind = 'sedan'): THREE.Group {
  let geometries = sharedGeometry.get(kind);
  if (!geometries) { geometries = buildSharedGeometry(kind); sharedGeometry.set(kind, geometries); }
  const car = new THREE.Group();
  car.name = `detailed-city-${kind}`;
  car.userData.vehicleForward = '+Z'; car.userData.vehicleKind = kind; car.userData.vehicleLabel = labels[kind]; car.userData.label = labels[kind];
  for (const part of parts) {
    const geometry = geometries[part]; if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, part === 'paint' ? painted(color) : materials[part]);
    mesh.name = `vehicle-${part}`; mesh.castShadow = true; mesh.receiveShadow = true; car.add(mesh);
  }
  const bounds = new THREE.Box3().setFromObject(car), size = bounds.getSize(new THREE.Vector3());
  car.userData.vehicleDimensions = { width: size.x, length: size.z, height: bounds.max.y, ...dynamics[kind] };
  car.userData.collisionHalfWidth = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x));
  car.userData.collisionHalfLength = Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z));
  return car;
}
