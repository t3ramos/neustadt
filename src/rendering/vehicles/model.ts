import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tr } from '../../i18n/index';

export type VehicleKind = 'sedan' | 'taxi' | 'van' | 'truck';
type Part =
  | 'paint'
  | 'windows'
  | 'tires-and-trim'
  | 'rims-and-metal'
  | 'headlights'
  | 'taillights'
  | 'cargo-and-details';
type Vec = readonly [number, number, number];
type Section = readonly [z: number, halfWidth: number, bottom: number, top: number, bevel: number];
const parts: Part[] = [
  'paint',
  'windows',
  'tires-and-trim',
  'rims-and-metal',
  'headlights',
  'taillights',
  'cargo-and-details',
];
const paintMaterials = new Map<number, THREE.MeshPhysicalMaterial>();
const sharedGeometry = new Map<VehicleKind, Partial<Record<Part, THREE.BufferGeometry>>>();
const materials: Record<Exclude<Part, 'paint'>, THREE.MeshStandardMaterial> = {
  windows: new THREE.MeshPhysicalMaterial({
    color: 0x244a57,
    metalness: 0.12,
    roughness: 0.075,
    clearcoat: 1,
    clearcoatRoughness: 0.055,
  }),
  'tires-and-trim': new THREE.MeshStandardMaterial({
    color: 0x222a2c,
    metalness: 0.03,
    roughness: 0.88,
  }),
  'rims-and-metal': new THREE.MeshStandardMaterial({
    color: 0xa7b7bb,
    metalness: 0.78,
    roughness: 0.24,
  }),
  headlights: new THREE.MeshStandardMaterial({
    color: 0xfff2ca,
    emissive: 0xffe4a8,
    emissiveIntensity: 0.65,
    metalness: 0.12,
    roughness: 0.16,
  }),
  taillights: new THREE.MeshStandardMaterial({
    color: 0xc44339,
    emissive: 0xc71910,
    emissiveIntensity: 0.55,
    metalness: 0.1,
    roughness: 0.23,
  }),
  'cargo-and-details': new THREE.MeshStandardMaterial({
    color: 0xbeb39b,
    roughness: 0.75,
    metalness: 0.04,
  }),
};
for (const [name, material] of Object.entries(materials)) material.name = `vehicle-${name}`;
function painted(color: number): THREE.MeshPhysicalMaterial {
  const normalized = new THREE.Color(color).getHex();
  let material = paintMaterials.get(normalized);
  if (!material) {
    material = new THREE.MeshPhysicalMaterial({
      color: normalized,
      metalness: 0.32,
      roughness: 0.21,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
    });
    material.name = `vehicle-paint-${normalized.toString(16).padStart(6, '0')}`;
    paintMaterials.set(normalized, material);
  }
  return material;
}

/** Rounded shoulder sections form a smooth, genuinely contoured painted shell. */
function beveledLoft(sections: readonly Section[]): THREE.BufferGeometry {
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const ringSize = 16;
  for (const [z, width, bottom, top, wantedBevel] of sections) {
    const bevel = Math.min(wantedBevel, width * 0.45, (top - bottom) * 0.45);
    const corners = [
      [width - bevel, bottom + bevel, -Math.PI / 2],
      [width - bevel, top - bevel, 0],
      [-width + bevel, top - bevel, Math.PI / 2],
      [-width + bevel, bottom + bevel, Math.PI],
    ];
    for (const [cx, cy, angle] of corners)
      for (let segment = 0; segment <= 3; segment++) {
        const theta = angle + (segment * Math.PI) / 6;
        const x = cx + Math.cos(theta) * bevel,
          y = cy + Math.sin(theta) * bevel;
        positions.push(x, y, z);
        uv.push(x / 0.24 + 0.5, z / 0.58 + 0.5);
      }
  }
  for (let section = 0; section < sections.length - 1; section++)
    for (let edge = 0; edge < ringSize; edge++) {
      const a = section * ringSize + edge,
        b = section * ringSize + ((edge + 1) % ringSize),
        c = (section + 1) * ringSize + ((edge + 1) % ringSize),
        d = (section + 1) * ringSize + edge;
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
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Cut actual circular wheel clearances into the lower painted silhouette. */
function archedBody(
  sections: readonly Section[],
  axles: readonly number[],
  wheelY: number,
  radius: number,
): THREE.BufferGeometry {
  const stops = new Set(sections.map((s) => s[0]));
  for (const axle of axles)
    for (let i = 0; i <= 8; i++) stops.add(axle + Math.cos((i / 8) * Math.PI) * (radius + 0.004));
  const profile = [...stops]
    .filter((z) => z >= sections[0][0] && z <= sections[sections.length - 1][0])
    .sort((a, b) => a - b)
    .map((z) => {
      const index = Math.max(
        0,
        sections.findIndex(
          (section, i) => i < sections.length - 1 && z >= section[0] && z <= sections[i + 1][0],
        ),
      );
      const a = sections[index],
        b = sections[index + 1];
      const t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
      const values = a.map((value, i) => THREE.MathUtils.lerp(value, b[i], t));
      let bottom = values[2];
      for (const axle of axles) {
        const delta = Math.abs(z - axle),
          archRadius = radius + 0.004;
        if (delta < archRadius)
          bottom = Math.max(bottom, wheelY + Math.sqrt(archRadius * archRadius - delta * delta));
      }
      return [z, values[1], Math.min(bottom, values[3] - 0.014), values[3], values[4]] as Section;
    });
  return beveledLoft(profile);
}

function quad(a: Vec, b: Vec, c: Vec, d: Vec): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

class VehicleBuilder {
  private buckets: Record<Part, THREE.BufferGeometry[]> = {
    paint: [],
    windows: [],
    'tires-and-trim': [],
    'rims-and-metal': [],
    headlights: [],
    taillights: [],
    'cargo-and-details': [],
  };
  add(part: Part, geometry: THREE.BufferGeometry): void {
    const plain = geometry.index ? geometry.toNonIndexed() : geometry;
    if (plain !== geometry) geometry.dispose();
    plain.clearGroups();
    this.buckets[part].push(plain);
  }
  box(
    part: Part,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    rotationY = 0,
  ): void {
    this.add(part, new THREE.BoxGeometry(w, h, d).rotateY(rotationY).translate(x, y, z));
  }
  cylinder(
    part: Part,
    x: number,
    y: number,
    z: number,
    radius: number,
    length: number,
    segments: number,
    axis: 'x' | 'y' | 'z' = 'y',
  ): void {
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
      geometry.name = `vehicle-${kind}-${part}-shared`;
      geometry.userData.shared = true;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      result[part] = geometry;
    }
    return result;
  }
}

function wheel(
  b: VehicleBuilder,
  side: number,
  x: number,
  y: number,
  z: number,
  radius: number,
  width: number,
  segments = 32,
): void {
  // The cross-section rounds over the shoulders. It is visibly different from
  // a higher-segment straight cylinder when viewed along the hood or fender.
  const profile =
    segments === 24
      ? [
          new THREE.Vector2(radius * 0.73, -width / 2),
          new THREE.Vector2(radius * 0.97, -width * 0.27),
          new THREE.Vector2(radius, 0),
          new THREE.Vector2(radius * 0.97, width * 0.27),
          new THREE.Vector2(radius * 0.73, width / 2),
        ]
      : [
          new THREE.Vector2(radius * 0.73, -width / 2),
          new THREE.Vector2(radius * 0.93, -width * 0.37),
          new THREE.Vector2(radius, -width * 0.13),
          new THREE.Vector2(radius, width * 0.13),
          new THREE.Vector2(radius * 0.93, width * 0.37),
          new THREE.Vector2(radius * 0.73, width / 2),
        ];
  const tire = new THREE.LatheGeometry(profile, segments);
  b.add('tires-and-trim', tire.rotateZ(Math.PI / 2).translate(side * x, y, z));
  const face = x + width / 2 - 0.0016;
  b.cylinder('tires-and-trim', side * face, y, z, radius * 0.68, 0.0012, 16, 'x');
  const rim = new THREE.TorusGeometry(radius * 0.64, 0.002, 3, segments);
  b.add('rims-and-metal', rim.rotateY(Math.PI / 2).translate(side * (face + 0.0002679492), y, z));
  b.cylinder('rims-and-metal', side * (face + 0.001), y, z, radius * 0.2, 0.001, 12, 'x');
  for (let spoke = 0; spoke < 5; spoke++) {
    const angle = (spoke * Math.PI * 2) / 5,
      dy = Math.cos(angle),
      dz = Math.sin(angle);
    const cy = y + dy * radius * 0.36,
      cz = z + dz * radius * 0.36,
      length = radius * 0.24,
      half = radius * 0.06;
    const points: Vec[] = [
      [side * (face + 0.001), cy - dy * length + dz * half, cz - dz * length - dy * half],
      [side * (face + 0.001), cy + dy * length + dz * half, cz + dz * length - dy * half],
      [side * (face + 0.001), cy + dy * length - dz * half, cz + dz * length + dy * half],
      [side * (face + 0.001), cy - dy * length - dz * half, cz - dz * length + dy * half],
    ];
    if (side < 0) points.reverse();
    b.add('rims-and-metal', quad(points[0], points[1], points[2], points[3]));
  }
  // Subtle molded tread ribs and an outer wheel-arch lip give close views
  // mechanical detail without additional materials or draw calls.
  const ribs = segments === 24 ? 4 : 8;
  for (let rib = 0; rib < ribs; rib++) {
    const angle = (rib * Math.PI * 2) / ribs;
    const geometry = new THREE.BoxGeometry(width * 0.16, 0.0012, 0.003);
    geometry
      .rotateX(angle)
      .translate(
        side * x,
        y + Math.cos(angle) * (radius - 0.0007),
        z + Math.sin(angle) * (radius - 0.0007),
      );
    b.add('tires-and-trim', geometry);
  }
  const arch = new THREE.TorusGeometry(radius + 0.0043, 0.0018, 3, 12, Math.PI);
  b.add('paint', arch.rotateY(Math.PI / 2).translate(side * (x - width * 0.16), y, z));
}

const sedanCabin = [
  { z: -0.092, bottomWidth: 0.069, topWidth: 0.067, top: 0.101 },
  { z: -0.045, bottomWidth: 0.071, topWidth: 0.056, top: 0.155 },
  { z: 0.029, bottomWidth: 0.071, topWidth: 0.056, top: 0.157 },
  { z: 0.079, bottomWidth: 0.068, topWidth: 0.066, top: 0.101 },
];
function cabinAt(z: number): { top: number; topWidth: number; bottomWidth: number } {
  const i = Math.min(
    sedanCabin.length - 2,
    Math.max(
      0,
      sedanCabin.findIndex((section, n) => n < sedanCabin.length - 1 && z <= sedanCabin[n + 1].z),
    ),
  );
  const a = sedanCabin[i],
    b = sedanCabin[i + 1],
    t = THREE.MathUtils.clamp((z - a.z) / (b.z - a.z), 0, 1);
  return {
    top: THREE.MathUtils.lerp(a.top, b.top, t),
    topWidth: THREE.MathUtils.lerp(a.topWidth, b.topWidth, t),
    bottomWidth: THREE.MathUtils.lerp(a.bottomWidth, b.bottomWidth, t),
  };
}
function sedanSide(side: number, z: number, y: number): Vec {
  const section = cabinAt(z);
  const x = THREE.MathUtils.lerp(
    section.bottomWidth,
    section.topWidth,
    (y - 0.096) / (section.top - 0.096),
  );
  return [side * (x + 0.0015), y, z];
}
function frontDetails(
  b: VehicleBuilder,
  front: number,
  rear: number,
  halfWidth: number,
  hoodY: number,
  scale = 1,
): void {
  b.box(
    'tires-and-trim',
    0,
    hoodY - 0.021 * scale,
    front - 0.004,
    halfWidth * 1.2,
    0.019 * scale,
    0.01,
  );
  for (let row = 0; row < 4; row++)
    b.box(
      'rims-and-metal',
      0,
      hoodY - 0.027 * scale + row * 0.0042 * scale,
      front + 0.001,
      halfWidth * 1.04,
      0.0015,
      0.0018,
    );
  b.box('rims-and-metal', 0, hoodY - 0.045 * scale, front - 0.004, halfWidth * 1.58, 0.005, 0.008);
  b.box('tires-and-trim', 0, hoodY - 0.039 * scale, rear + 0.004, halfWidth * 1.5, 0.013, 0.01);
  b.box(
    'cargo-and-details',
    0,
    hoodY - 0.039 * scale,
    front + 0.004,
    0.027 * scale,
    0.008 * scale,
    0.002,
  );
  b.box(
    'cargo-and-details',
    0,
    hoodY - 0.029 * scale,
    rear - 0.003,
    0.027 * scale,
    0.008 * scale,
    0.002,
  );
  for (const side of [-1, 1]) {
    b.box(
      'headlights',
      side * halfWidth * 0.63,
      hoodY,
      front + 0.004,
      halfWidth * 0.37,
      0.011 * scale,
      0.011,
    );
    b.box(
      'taillights',
      side * halfWidth * 0.64,
      hoodY,
      rear - 0.004,
      halfWidth * 0.4,
      0.013 * scale,
      0.01,
    );
    b.box(
      'headlights',
      side * halfWidth * 0.7,
      hoodY - 0.024 * scale,
      front + 0.002,
      0.013,
      0.004,
      0.004,
    );
    // Dark lens dividers, reflectors and a high brake strip stay separate from paint.
    b.box(
      'tires-and-trim',
      side * halfWidth * 0.64,
      hoodY + 0.003,
      rear - 0.0082,
      0.0014,
      0.011 * scale,
      0.001,
    );
  }
}

function sedan(b: VehicleBuilder, taxi: boolean): void {
  b.add(
    'paint',
    archedBody(
      [
        [-0.16, 0.055, 0.043, 0.07, 0.007],
        [-0.15, 0.073, 0.032, 0.087, 0.01],
        [-0.114, 0.08, 0.0285, 0.098, 0.01],
        [-0.043, 0.08, 0.029, 0.1, 0.01],
        [0.066, 0.08, 0.029, 0.098, 0.011],
        [0.128, 0.077, 0.032, 0.091, 0.011],
        [0.151, 0.068, 0.039, 0.081, 0.009],
        [0.16, 0.053, 0.047, 0.07, 0.005],
      ],
      [-0.105, 0.105],
      0.039,
      0.026,
    ),
  );
  b.box('tires-and-trim', 0, 0.041, 0, 0.094, 0.02, 0.254);
  for (let i = 0; i < sedanCabin.length - 1; i++) {
    const a = sedanCabin[i],
      c = sedanCabin[i + 1];
    b.add(
      'paint',
      quad(
        [-a.topWidth, a.top, a.z],
        [-c.topWidth, c.top, c.z],
        [c.topWidth, c.top, c.z],
        [a.topWidth, a.top, a.z],
      ),
    );
    for (const side of [-1, 1]) {
      const points: Vec[] = [
        [side * a.bottomWidth, 0.096, a.z],
        [side * a.topWidth, a.top, a.z],
        [side * c.topWidth, c.top, c.z],
        [side * c.bottomWidth, 0.096, c.z],
      ];
      if (side < 0) points.reverse();
      b.add('paint', quad(points[0], points[1], points[2], points[3]));
    }
  }
  b.add(
    'paint',
    beveledLoft([
      [-0.047, 0.055, 0.152, 0.157, 0.0018],
      [-0.036, 0.058, 0.154, 0.161, 0.0026],
      [0.016, 0.058, 0.155, 0.163, 0.0026],
      [0.031, 0.055, 0.153, 0.159, 0.002],
    ]),
  );
  for (const [backZ, frontZ] of [
    [0.033, 0.074],
    [-0.086, -0.05],
  ]) {
    const a = cabinAt(backZ),
      c = cabinAt(frontZ);
    b.add(
      'windows',
      quad(
        [-a.topWidth + 0.004, a.top + 0.0008, backZ],
        [-c.topWidth + 0.004, c.top + 0.0008, frontZ],
        [c.topWidth - 0.004, c.top + 0.0008, frontZ],
        [a.topWidth - 0.004, a.top + 0.0008, backZ],
      ),
    );
  }
  for (const side of [-1, 1]) {
    const panes = [
      [
        sedanSide(side, -0.012, 0.104),
        sedanSide(side, -0.012, 0.15),
        sedanSide(side, 0.025, 0.15),
        sedanSide(side, 0.067, 0.104),
      ],
      [
        sedanSide(side, -0.076, 0.104),
        sedanSide(side, -0.043, 0.148),
        sedanSide(side, -0.019, 0.149),
        sedanSide(side, -0.019, 0.104),
      ],
    ];
    for (const points of panes) {
      if (side < 0) points.reverse();
      b.add('windows', quad(points[0], points[1], points[2], points[3]));
    }
    b.box('paint', side * 0.0839, 0.112, 0.046, 0.013, 0.01, 0.018, side * -0.12);
    b.box('windows', side * 0.086, 0.112, 0.037, 0.01, 0.006, 0.002);
    for (const z of [-0.001, -0.055])
      b.box('rims-and-metal', side * 0.0788, 0.093, z, 0.002, 0.004, 0.014);
    b.box('tires-and-trim', side * 0.0801, 0.071, -0.018, 0.0012, 0.042, 0.0015);
    b.box('tires-and-trim', side * 0.077, 0.045, -0.001, 0.009, 0.01, 0.17);
    b.box('rims-and-metal', side * 0.0795, 0.052, -0.001, 0.002, 0.0028, 0.168);
    for (const z of [-0.105, 0.105]) wheel(b, side, 0.079, 0.039, z, 0.026, 0.0242);
    if (taxi)
      for (let i = 0; i < 8; i++)
        b.box('tires-and-trim', side * 0.0806, 0.087, -0.06 + i * 0.015, 0.0014, 0.006, 0.009);
  }
  frontDetails(b, 0.16, -0.16, 0.076, 0.078);
  b.box('taillights', 0, 0.118, -0.078, 0.049, 0.003, 0.002);
  for (const x of [-0.027, 0.027])
    b.box('tires-and-trim', x, 0.1105, 0.071, 0.035, 0.0018, 0.002, x < 0 ? -0.12 : 0.12);
  if (taxi) {
    b.box('rims-and-metal', 0, 0.168, -0.008, 0.033, 0.011, 0.015);
    b.add(
      'cargo-and-details',
      beveledLoft([
        [-0.026, 0.031, 0.171, 0.188, 0.003],
        [0.005, 0.029, 0.171, 0.188, 0.003],
      ]),
    );
    // A compact readable TAXI-style mark, plus the conventional checker band.
    for (const x of [-0.019, -0.006, 0.008, 0.02])
      b.box('tires-and-trim', x, 0.181, 0.006, 0.006, 0.008, 0.0015);
    b.box('cargo-and-details', 0, 0.182, -0.027, 0.043, 0.005, 0.001);
  }
}

function commercialCab(
  b: VehicleBuilder,
  rear: number,
  windTop: number,
  windBottom: number,
  halfWidth: number,
  topWidth: number,
  floor: number,
  roof: number,
): void {
  const sections: Section[] = [
    [rear, halfWidth - 0.007, floor, roof - 0.005, 0.01],
    [rear + 0.014, halfWidth, floor, roof, 0.012],
    [windTop, halfWidth, floor, roof - 0.004, 0.009],
    [windBottom, halfWidth - 0.005, floor, floor + 0.024, 0.008],
  ];
  b.add('paint', beveledLoft(sections));
  const at = (z: number) => {
    const i = Math.max(
      0,
      sections.findIndex((s, n) => n < sections.length - 1 && z >= s[0] && z <= sections[n + 1][0]),
    );
    const a = sections[i],
      c = sections[i + 1],
      t = THREE.MathUtils.clamp((z - a[0]) / (c[0] - a[0]), 0, 1);
    return a.map((value, n) => THREE.MathUtils.lerp(value, c[n], t));
  };
  const topZ = windTop + 0.004,
    bottomZ = windBottom - 0.004;
  const yTop = at(topZ)[3] + 0.0013,
    yBottom = at(bottomZ)[3] + 0.0013;
  b.add(
    'windows',
    quad(
      [-topWidth, yTop, topZ],
      [-halfWidth + 0.015, yBottom, bottomZ],
      [halfWidth - 0.015, yBottom, bottomZ],
      [topWidth, yTop, topZ],
    ),
  );
  for (const side of [-1, 1]) {
    // Follow the curved painted shoulder with a subdivided glass surface.
    // Corner-only quads can dip underneath a rounded cabin at their centre.
    const bottomRear: Vec = [0, floor + 0.019, rear + 0.013],
      topRear: Vec = [0, roof - 0.017, rear + 0.018];
    const topFront: Vec = [0, roof - 0.02, windTop - 0.004],
      bottomFront: Vec = [0, floor + 0.036, windBottom - 0.012];
    const positions: number[] = [],
      uvs: number[] = [],
      indices: number[] = [];
    const nu = 4,
      nv = 3;
    for (let uIndex = 0; uIndex <= nu; uIndex++)
      for (let vIndex = 0; vIndex <= nv; vIndex++) {
        const u = uIndex / nu,
          v = vIndex / nv;
        const y = THREE.MathUtils.lerp(
          THREE.MathUtils.lerp(bottomRear[1], bottomFront[1], u),
          THREE.MathUtils.lerp(topRear[1], topFront[1], u),
          v,
        );
        const z = THREE.MathUtils.lerp(
          THREE.MathUtils.lerp(bottomRear[2], bottomFront[2], u),
          THREE.MathUtils.lerp(topRear[2], topFront[2], u),
          v,
        );
        const section = at(z),
          w = section[1],
          top = section[3],
          radius = Math.min(section[4], (top - floor) * 0.45);
        const dy = Math.max(0, y - (top - radius));
        const x = dy > 0 ? w - radius + Math.sqrt(Math.max(0, radius * radius - dy * dy)) : w;
        positions.push(side * (x + 0.0016), y, z);
        uvs.push(u, v);
      }
    for (let u = 0; u < nu; u++)
      for (let v = 0; v < nv; v++) {
        const a = u * (nv + 1) + v,
          c = (u + 1) * (nv + 1) + v,
          d = c + 1,
          e = a + 1;
        if (side > 0) indices.push(a, e, c, e, d, c);
        else indices.push(a, c, e, e, c, d);
      }
    const pane = new THREE.BufferGeometry();
    pane.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    pane.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    pane.setIndex(indices);
    pane.computeVertexNormals();
    b.add('windows', pane);
    b.box(
      'paint',
      side * (halfWidth + 0.016),
      floor + 0.057,
      windBottom - 0.025,
      0.014,
      0.02,
      0.025,
    );
    b.box(
      'windows',
      side * (halfWidth + 0.02),
      floor + 0.057,
      windBottom - 0.039,
      0.009,
      0.014,
      0.002,
    );
    b.box(
      'rims-and-metal',
      side * (halfWidth + 0.0015),
      floor + 0.01,
      rear + 0.035,
      0.002,
      0.004,
      0.018,
    );
  }
  for (const x of [-0.03, 0.03])
    b.box('tires-and-trim', x, yBottom + 0.003, bottomZ, 0.038, 0.0018, 0.002, x < 0 ? -0.1 : 0.1);
}

function van(b: VehicleBuilder): void {
  b.add(
    'paint',
    archedBody(
      [
        [-0.181, 0.073, 0.042, 0.111, 0.013],
        [-0.169, 0.088, 0.033, 0.115, 0.012],
        [-0.11, 0.089, 0.029, 0.115, 0.012],
        [0.083, 0.089, 0.03, 0.118, 0.011],
        [0.157, 0.083, 0.04, 0.107, 0.012],
        [0.185, 0.067, 0.048, 0.09, 0.01],
      ],
      [-0.124, 0.125],
      0.043,
      0.03,
    ),
  );
  b.add(
    'paint',
    beveledLoft([
      [-0.177, 0.077, 0.105, 0.218, 0.013],
      [-0.157, 0.086, 0.105, 0.227, 0.014],
      [0.045, 0.086, 0.105, 0.227, 0.014],
      [0.059, 0.082, 0.105, 0.219, 0.013],
    ]),
  );
  commercialCab(b, 0.044, 0.089, 0.15, 0.084, 0.07, 0.107, 0.223);
  b.box('tires-and-trim', 0, 0.046, 0, 0.11, 0.023, 0.31);
  for (const side of [-1, 1]) {
    for (const z of [-0.124, 0.125]) wheel(b, side, 0.088, 0.043, z, 0.03, 0.027, 32);
    // Sliding-door rail, recessed door seam and a commercial cargo badge.
    b.box('rims-and-metal', side * 0.0869, 0.152, -0.071, 0.0014, 0.003, 0.178);
    for (const z of [-0.154, 0.011])
      b.box('tires-and-trim', side * 0.0872, 0.159, z, 0.0014, 0.094, 0.0014);
    b.box('cargo-and-details', side * 0.0874, 0.185, -0.067, 0.0016, 0.024, 0.074);
    b.box('rims-and-metal', side * 0.0882, 0.137, 0.004, 0.0015, 0.004, 0.019);
  }
  b.box('tires-and-trim', 0, 0.163, -0.181, 0.002, 0.109, 0.003);
  for (const side of [-1, 1]) {
    b.box('cargo-and-details', side * 0.043, 0.177, -0.18, 0.065, 0.075, 0.003);
    b.box('rims-and-metal', side * 0.015, 0.144, -0.183, 0.004, 0.026, 0.002);
    b.box('taillights', side * 0.07, 0.125, -0.184, 0.012, 0.043, 0.01);
  }
  frontDetails(b, 0.185, -0.18, 0.084, 0.091, 1.05);
}

function truck(b: VehicleBuilder): void {
  b.box('tires-and-trim', 0, 0.066, -0.02, 0.112, 0.032, 0.512);
  for (const x of [-0.04, 0.04]) b.box('rims-and-metal', x, 0.067, -0.02, 0.018, 0.02, 0.518);
  b.add(
    'paint',
    archedBody(
      [
        [0.078, 0.08, 0.066, 0.149, 0.014],
        [0.094, 0.098, 0.048, 0.153, 0.012],
        [0.181, 0.098, 0.042, 0.152, 0.014],
        [0.239, 0.089, 0.051, 0.134, 0.014],
        [0.275, 0.075, 0.064, 0.111, 0.01],
      ],
      [0.184],
      0.049,
      0.036,
    ),
  );
  commercialCab(b, 0.084, 0.194, 0.257, 0.094, 0.079, 0.135, 0.259);
  // An open flatbed is separate from the cab and can be inspected from above.
  b.box('rims-and-metal', 0, 0.101, -0.1, 0.205, 0.024, 0.35);
  for (let plank = 0; plank < 8; plank++)
    b.box('cargo-and-details', -0.079 + plank * 0.0225, 0.118, -0.1, 0.021, 0.013, 0.335);
  for (const side of [-1, 1]) {
    b.box('paint', side * 0.104, 0.158, -0.1, 0.012, 0.073, 0.354);
    b.box('rims-and-metal', side * 0.1098, 0.201, -0.1, 0.008, 0.006, 0.354);
    for (const z of [-0.237, -0.13, -0.023])
      b.box('rims-and-metal', side * 0.111, 0.162, z, 0.002, 0.076, 0.012);
    for (const z of [-0.19, -0.115, 0.184]) wheel(b, side, 0.096, 0.049, z, 0.036, 0.031, 24);
    b.box('tires-and-trim', side * 0.098, 0.054, -0.232, 0.03, 0.058, 0.004);
    b.box('rims-and-metal', side * 0.083, 0.102, 0.246, 0.018, 0.007, 0.07);
    b.box('rims-and-metal', side * 0.08, 0.082, 0.215, 0.027, 0.006, 0.063);
    b.box('cargo-and-details', side * 0.103, 0.124, -0.23, 0.009, 0.004, 0.008);
  }
  b.box('paint', 0, 0.158, -0.274, 0.212, 0.073, 0.012);
  b.box('paint', 0, 0.168, 0.072, 0.212, 0.099, 0.012);
  for (const x of [-0.071, 0.071]) {
    b.box('rims-and-metal', x, 0.166, -0.281, 0.01, 0.045, 0.003);
    b.box('rims-and-metal', x, 0.203, -0.276, 0.024, 0.004, 0.012);
  }
  // Two small parcels leave a visibly open central cargo floor and distinguish
  // the vehicle from the high opaque body of an ambulance or delivery van.
  for (const x of [-0.056, 0.056]) {
    b.box('cargo-and-details', x, 0.145, -0.206, 0.053, 0.043, 0.075);
    b.box('tires-and-trim', x, 0.167, -0.206, 0.005, 0.001, 0.076);
  }
  frontDetails(b, 0.277, -0.279, 0.094, 0.118, 1.2);
  // Large practical grille, not a light bar or emergency vehicle marking.
  for (let slot = 0; slot < 7; slot++)
    b.box('tires-and-trim', -0.05 + slot * 0.0167, 0.134, 0.268, 0.009, 0.025, 0.003);
}

function buildSharedGeometry(kind: VehicleKind): Partial<Record<Part, THREE.BufferGeometry>> {
  const b = new VehicleBuilder();
  if (kind === 'sedan' || kind === 'taxi') sedan(b, kind === 'taxi');
  else if (kind === 'van') van(b);
  else truck(b);
  return b.finish(kind);
}

export function vehicleKindLabel(kind: VehicleKind): string {
  switch (kind) {
    case 'sedan':
      return tr('Limousine', 'Sedan');
    case 'taxi':
      return tr('Taxi', 'Taxi');
    case 'van':
      return tr('Transporter', 'Van');
    case 'truck':
      return tr('Lastwagen', 'Truck');
  }
}

/** Re-label a live fleet without rebuilding geometry or disturbing traffic. */
export function refreshVehicleLabel(car: THREE.Object3D): void {
  const kind = car.userData.vehicleKind;
  if (kind !== 'sedan' && kind !== 'taxi' && kind !== 'van' && kind !== 'truck') return;
  car.userData.vehicleLabel = vehicleKindLabel(kind);
  car.userData.label = car.userData.vehicleLabel;
}
const dynamics: Record<VehicleKind, { wheelBase: number; mass: number }> = {
  sedan: { wheelBase: 0.21, mass: 1 },
  taxi: { wheelBase: 0.21, mass: 1 },
  van: { wheelBase: 0.249, mass: 1.4 },
  truck: { wheelBase: 0.3365, mass: 2.5 },
};

/** All four genuinely different body types share at most seven GPU batches. */
export function createDetailedCar(color: number, kind: VehicleKind = 'sedan'): THREE.Group {
  let geometries = sharedGeometry.get(kind);
  if (!geometries) {
    geometries = buildSharedGeometry(kind);
    sharedGeometry.set(kind, geometries);
  }
  const car = new THREE.Group();
  car.name = `detailed-city-${kind}`;
  car.userData.vehicleForward = '+Z';
  car.userData.vehicleKind = kind;
  refreshVehicleLabel(car);
  for (const part of parts) {
    const geometry = geometries[part];
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, part === 'paint' ? painted(color) : materials[part]);
    mesh.name = `vehicle-${part}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    car.add(mesh);
  }
  const bounds = new THREE.Box3().setFromObject(car),
    size = bounds.getSize(new THREE.Vector3());
  car.userData.vehicleDimensions = {
    width: size.x,
    length: size.z,
    height: bounds.max.y,
    ...dynamics[kind],
  };
  car.userData.collisionHalfWidth = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x));
  car.userData.collisionHalfLength = Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z));
  return car;
}
