import * as THREE from 'three';

export type CommercialFamily = 'curtain' | 'brick' | 'limestone' | 'charcoal' | 'campus';
const schemes: Record<
  CommercialFamily,
  { wall: number; glass: number; frame: number; columns: number; rows: number; roughness: number }
> = {
  curtain: {
    wall: 0x8ba8b5,
    glass: 0x658797,
    frame: 0xc5d3d5,
    columns: 7,
    rows: 15,
    roughness: 0.28,
  },
  brick: {
    wall: 0x8c4f3b,
    glass: 0x3b3b3b,
    frame: 0xbf9374,
    columns: 5,
    rows: 10,
    roughness: 0.78,
  },
  limestone: {
    wall: 0xe6dfcd,
    glass: 0x877b66,
    frame: 0xf4eddc,
    columns: 6,
    rows: 8,
    roughness: 0.7,
  },
  charcoal: {
    wall: 0x292e34,
    glass: 0x454f57,
    frame: 0x929899,
    columns: 9,
    rows: 15,
    roughness: 0.36,
  },
  campus: {
    wall: 0xbfc4c5,
    glass: 0x657f88,
    frame: 0xe0e3de,
    columns: 9,
    rows: 7,
    roughness: 0.58,
  },
};
const materials = new Map<string, THREE.MeshStandardMaterial>();
let nightBlend = 0;
let wet = false;

function texture(
  data: Uint8Array,
  width: number,
  height: number,
  color = false,
): THREE.DataTexture {
  const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  // The renderer clamps this request to the device limit. Trilinear mipmaps
  // still provide a stable fallback on devices without anisotropic filtering.
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}

function noise(x: number, y: number, seed: number): number {
  let value = Math.imul(x + seed * 131, 374761393) ^ Math.imul(y + 17, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function channel(color: number, shift: number, gain: number, lift = 0): number {
  return Math.max(0, Math.min(255, Math.round(((color >> shift) & 255) * gain + lift)));
}

/** Lazily cached, bounded to five families × two scales; no per-building maps. */
export function commercialFacadeMaterial(
  family: CommercialFamily,
  medium = false,
): THREE.MeshStandardMaterial {
  const cached = materials.get(`${family}:${medium}`);
  if (cached) return cached;
  const scheme = medium ? { ...schemes[family], columns: 4, rows: 3 } : schemes[family],
    width = 256,
    height = medium ? 256 : 512;
  const pixels = new Uint8Array(width * height * 4),
    lights = new Uint8Array(pixels.length);
  const roughness = new Uint8Array(pixels.length);
  const normals = new Uint8Array(pixels.length);
  const relief = new Float32Array(width * height);
  const vertical = family === 'curtain' || family === 'charcoal';
  const seed = Object.keys(schemes).indexOf(family) + 1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const column = Math.floor((x / width) * scheme.columns),
        row = Math.floor((y / height) * scheme.rows);
      const u = ((x / width) * scheme.columns) % 1,
        v = ((y / height) * scheme.rows) % 1;
      const left = vertical ? 0.075 : 0.22,
        right = 1 - left,
        bottom = 0.15,
        top = 0.86;
      const pane = u > left && u < right && v > bottom && v < top;
      const mullion = vertical ? u < 0.075 || u > 0.925 : v < 0.055;
      const room = noise(column, row, seed);
      const grain = noise(x, y, seed) - 0.5;
      let color = scheme.wall,
        gain = 1,
        lift = 0,
        r = scheme.roughness,
        metal = 0,
        depth = 0.35,
        emission = 0;
      if (pane) {
        const pu = (u - left) / (right - left),
          pv = (v - bottom) / (top - bottom);
        // Restrained baked sky/interior cues supplement real environment
        // reflections without a shader hook or transparent sorting costs.
        const sky = pv * pv;
        const reflection = Math.max(0, Math.sin(pu * 5 + pv * 3 + room * 2));
        color = scheme.glass;
        gain = 0.7 + room * 0.24 + sky * 0.22 + reflection * 0.055;
        lift = sky * 12;
        r = 0.13 + room * 0.09;
        depth = -0.22 + Math.sin(pu * Math.PI) * Math.sin(pv * Math.PI) * 0.025;
        const edge = Math.min(pu, 1 - pu, pv, 1 - pv);
        // Black rubber seals, a reveal shadow, and the bright lower sill.
        if (edge < 0.045) {
          gain *= 0.43;
          r = 0.48;
          depth = -0.3;
        } else {
          const blindHeight = room > 0.64 ? 0.32 + room * 0.43 : 0;
          const blind = pv > 1 - blindHeight;
          const curtain = room < 0.24 && (pu < 0.19 || pu > 0.86);
          const furniture = pv < 0.23 && pu > 0.28 && pu < 0.73 && room > 0.28;
          if (blind || curtain) {
            color = room > 0.82 ? 0xb5afa0 : 0x87969a;
            gain = blind ? 0.75 + Math.sin(pv * 95) * 0.055 : 0.75 + Math.sin(pu * 65) * 0.1;
            // Interior detail is behind the glazing: it must not emboss
            // the outer glass or change its dielectric metalness.
          }
          if (furniture) gain *= 0.58;
          if (pv < 0.075) gain *= 1.22;
          const lit = (column * 13 + row * 7 + column * row) % 11 < 3;
          if (lit) emission = (blind ? 0.42 : curtain ? 0.55 : 0.8) * (furniture ? 0.35 : 1);
        }
      } else {
        const trim = u > left - 0.035 && u < right + 0.035 && v > bottom - 0.035 && v < top + 0.035;
        if (trim || mullion) {
          color = scheme.frame;
          gain = 0.86 + grain * 0.04;
          depth = 0.72;
          r = vertical ? 0.32 : 0.57;
          metal = vertical || family === 'campus' ? 0.72 : 0;
          if (v < bottom && trim) gain = 1.08;
        } else if (family === 'brick') {
          const course = Math.floor(y / 8),
            bx = (x + (course % 2) * 12) % 24,
            by = y % 8;
          const joint = bx < 1.3 || by < 1.3;
          color = joint ? 0x827568 : scheme.wall;
          gain = joint
            ? 0.83
            : 0.86 +
              noise(Math.floor((x + (course % 2) * 12) / 24), course, seed) * 0.28 +
              grain * 0.09;
          depth = joint ? 0.02 : 0.4 + grain * 0.12;
          r = joint ? 0.96 : 0.82 + grain * 0.12;
        } else if (family === 'limestone' || family === 'campus') {
          const course = Math.floor(y / 16),
            bx = (x + (course % 2) * 16) % 32;
          const joint = bx < 1 || y % 16 < 1;
          gain = joint
            ? 0.75
            : 0.95 +
              noise(Math.floor((x + (course % 2) * 16) / 32), course, seed) * 0.08 +
              grain * 0.035;
          depth = joint ? 0.06 : 0.37 + grain * 0.035;
          r = family === 'limestone' ? 0.78 + grain * 0.08 : 0.58 + grain * 0.06;
        } else {
          // Opaque enamel spandrels between each occupied floor.
          gain = 0.76 + room * 0.1 + grain * 0.018;
          depth = 0.3;
          r = family === 'charcoal' ? 0.46 : 0.36;
          metal = 0.3;
        }
      }
      const i = (y * width + x) * 4;
      pixels.set(
        [
          channel(color, 16, gain, lift),
          channel(color, 8, gain, lift),
          channel(color, 0, gain, lift),
          255,
        ],
        i,
      );
      lights.set(
        [
          Math.round(255 * emission),
          Math.round((201 + room * 24) * emission),
          Math.round((139 + room * 34) * emission),
          255,
        ],
        i,
      );
      // Standard material uses green for roughness and blue for metalness,
      // so one linear-data map serves both slots (glass remains dielectric).
      roughness.set([255, Math.round(r * 255), Math.round(metal * 255), 255], i);
      relief[y * width + x] = depth;
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      // DataTexture rows follow increasing V (flipY=false); central
      // differences therefore use the same Y sign as tangent-space normals.
      const dx =
        relief[y * width + Math.max(0, x - 1)] - relief[y * width + Math.min(width - 1, x + 1)];
      const dy =
        relief[Math.max(0, y - 1) * width + x] - relief[Math.min(height - 1, y + 1) * width + x];
      const length = Math.hypot(dx, dy, 1);
      normals.set(
        [
          Math.round(((dx / length) * 0.5 + 0.5) * 255),
          Math.round(((dy / length) * 0.5 + 0.5) * 255),
          Math.round(((1 / length) * 0.5 + 0.5) * 255),
          255,
        ],
        (y * width + x) * 4,
      );
    }
  const surface = texture(roughness, width, height);
  const material = new THREE.MeshStandardMaterial({
    map: texture(pixels, width, height, true),
    emissiveMap: texture(lights, width, height, true),
    roughnessMap: surface,
    metalnessMap: surface,
    normalMap: texture(normals, width, height),
    normalScale: new THREE.Vector2(0.65, 0.65),
    roughness: wet ? 0.65 : 1,
    emissive: 0xffffff,
    emissiveIntensity: nightBlend * 0.15,
    metalness: 1,
  });
  material.name = `commercial-${family}-${medium ? 'medium' : 'highrise'}-facade`;
  material.userData.glazing = true;
  material.userData.facadeTexture = true;
  material.forceSinglePass = true;
  materials.set(`${family}:${medium}`, material);
  return material;
}

export function updateCommercialFacadeNight(blend: number): void {
  nightBlend = blend;
  for (const material of materials.values()) material.emissiveIntensity = blend * 0.15;
}
export function updateCommercialFacadeWet(value: boolean): void {
  wet = value;
  for (const material of materials.values()) material.roughness = value ? 0.65 : 1;
}
