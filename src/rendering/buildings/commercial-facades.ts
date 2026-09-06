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
  map.needsUpdate = true;
  return map;
}

/** Five small shared texture sets replace hundreds of individual window meshes. */
export function commercialFacadeMaterial(
  family: CommercialFamily,
  medium = false,
): THREE.MeshStandardMaterial {
  const cached = materials.get(`${family}:${medium}`);
  if (cached) return cached;
  const scheme = medium ? { ...schemes[family], columns: 4, rows: 3 } : schemes[family],
    width = 128,
    height = 256;
  const pixels = new Uint8Array(width * height * 4),
    lights = new Uint8Array(pixels.length);
  const roughness = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const column = Math.floor((x / width) * scheme.columns),
        row = Math.floor((y / height) * scheme.rows);
      const u = ((x / width) * scheme.columns) % 1,
        v = ((y / height) * scheme.rows) % 1;
      const vertical = family === 'curtain' || family === 'charcoal';
      const pane =
        u > (vertical ? 0.075 : 0.22) && u < (vertical ? 0.925 : 0.78) && v > 0.15 && v < 0.86;
      const mullion = vertical ? u < 0.075 || u > 0.925 : v < 0.055;
      let color = pane ? scheme.glass : mullion ? scheme.frame : scheme.wall;
      // Shallow brick courses and staggered joints stay in the texture budget.
      if (
        family === 'brick' &&
        !pane &&
        (y % 5 === 0 || (x + (Math.floor(y / 5) % 2) * 6) % 13 === 0)
      )
        color = 0x724638;
      const i = (y * width + x) * 4;
      pixels.set([(color >> 16) & 255, (color >> 8) & 255, color & 255, 255], i);
      const lit = pane && (column * 13 + row * 7 + column * row) % 11 < 3;
      lights.set(lit ? [255, 211, 154, 255] : [0, 0, 0, 255], i);
      const r = pane ? 90 : Math.round(scheme.roughness * 255);
      roughness.set([r, r, r, 255], i);
    }
  const material = new THREE.MeshStandardMaterial({
    map: texture(pixels, width, height, true),
    emissiveMap: texture(lights, width, height, true),
    roughnessMap: texture(roughness, width, height),
    roughness: wet ? 0.65 : 1,
    emissive: 0xffffff,
    emissiveIntensity: nightBlend * 0.15,
    metalness: family === 'curtain' || family === 'charcoal' ? 0.22 : 0.025,
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
