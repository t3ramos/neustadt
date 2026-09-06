import * as THREE from 'three';

// All vertical faces retain their full UV range; top and bottom sample a plain
// wall texel. One shared unit geometry keeps roofs free of painted windows.
export const facadeBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
const uv = facadeBoxGeometry.getAttribute('uv');
for (let vertex = 8; vertex < 16; vertex++) uv.setXY(vertex, 0.01, 0.01);
const patterns = new Map<number, { map: THREE.DataTexture; lights: THREE.DataTexture }>();
const materials = new Map<string, THREE.MeshStandardMaterial>();
let night = 0,
  wet = false;
function pattern(rows: number): { map: THREE.DataTexture; lights: THREE.DataTexture } {
  const old = patterns.get(rows);
  if (old) return old;
  const width = 64,
    height = 64,
    color = new Uint8Array(width * height * 4),
    glow = new Uint8Array(color.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x / width,
        v = y / height;
      const col = Math.floor(u * 3),
        row = Math.floor(((v - 0.18) / 0.7) * rows);
      const cx = (u * 3) % 1,
        cy = (((v - 0.18) / 0.7) * rows) % 1;
      const pane = v > 0.18 && v < 0.88 && cx > 0.22 && cx < 0.78 && cy > 0.17 && cy < 0.78;
      const frame = v > 0.18 && v < 0.88 && cx > 0.18 && cx < 0.82 && cy > 0.12 && cy < 0.83;
      const index = (y * width + x) * 4;
      color.set(
        pane ? [77, 100, 110, 255] : frame ? [214, 213, 201, 255] : [255, 255, 255, 255],
        index,
      );
      glow.set(pane && (col + row * 3) % 4 === 1 ? [255, 218, 165, 255] : [0, 0, 0, 255], index);
    }
  const make = (pixels: Uint8Array) => {
    const map = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.needsUpdate = true;
    return map;
  };
  const result = { map: make(color), lights: make(glow) };
  patterns.set(rows, result);
  return result;
}
function materialFor(source: THREE.MeshStandardMaterial, rows: number): THREE.MeshStandardMaterial {
  const key = `${source.color.getHex()}:${rows}`;
  const old = materials.get(key);
  if (old) return old;
  const maps = pattern(rows);
  const material = new THREE.MeshStandardMaterial({
    color: source.color,
    map: maps.map,
    emissiveMap: maps.lights,
    emissive: 0xffffff,
    emissiveIntensity: night * 0.12,
    roughness: wet ? 0.58 : 0.84,
    metalness: 0.02,
  });
  material.name = `four-sided-openings-${key}`;
  material.userData.facadeTexture = true;
  material.userData.fourSidedOpenings = true;
  material.forceSinglePass = true;
  materials.set(key, material);
  return material;
}
/** Decorate existing occupied walls, never equipment, ground slabs or roof caps. */
export function addFourSidedOpenings(group: THREE.Group): void {
  group.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh) ||
      object.geometry.type !== 'BoxGeometry' ||
      Array.isArray(object.material)
    )
      return;
    const material = object.material;
    if (
      !(material instanceof THREE.MeshStandardMaterial) ||
      material.userData.glazing ||
      material.userData.facadeTexture ||
      object.userData.noFacadeOpenings ||
      object.userData.facilityFoundation ||
      object.userData.fireRoof
    )
      return;
    const [w, h, d] = object.scale.toArray().map(Math.abs);
    if (w < 0.24 || d < 0.24 || h < 0.3 || object.position.y < h / 2 - 0.001) return;
    if (Math.abs(object.rotation.x) + Math.abs(object.rotation.z) > 0.01) return;
    // Keep slender trim, machinery and water tanks outside this wall treatment.
    if (w / d > 6 || d / w > 6 || h / Math.min(w, d) > 8) return;
    object.geometry = facadeBoxGeometry;
    object.material = materialFor(material, h < 0.6 ? 1 : h < 1.25 ? 2 : 3);
    object.userData.fourSidedOpenings = true;
  });
}
export function updateOpeningNight(blend: number): void {
  night = blend;
  for (const material of materials.values()) material.emissiveIntensity = blend * 0.12;
}
export function updateOpeningWet(value: boolean): void {
  wet = value;
  for (const material of materials.values()) material.roughness = value ? 0.58 : 0.84;
}
