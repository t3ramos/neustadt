import * as THREE from 'three';

const materials = new Map<number, THREE.MeshStandardMaterial>();
let wet = false;

/** Roof relief is filtered texture detail, never hundreds of subpixel roof strips. */
export function roofSurfaceMaterial(color: number): THREE.MeshStandardMaterial {
  const cached = materials.get(color);
  if (cached) return cached;
  const edge = 128;
  const albedo = new Uint8Array(edge * edge * 4);
  const normals = new Uint8Array(albedo.length);
  const heights = new Float32Array(edge * edge);
  for (let y = 0; y < edge; y++) {
    for (let x = 0; x < edge; x++) {
      const row = Math.floor(y / 16);
      const u = ((x + (row % 2) * 4) % 8) / 8;
      const v = (y % 16) / 16;
      const tile = Math.floor((x + (row % 2) * 4) / 8);
      const variance = Math.sin(tile * 37 + row * 13) * 0.035;
      // Broad, low-contrast courses and softly curved tile crowns survive minification.
      const gain = 0.93 + variance + Math.sin(u * Math.PI) * 0.05 - (v < 0.07 ? 0.075 : 0);
      const index = (y * edge + x) * 4;
      albedo.set(
        [
          Math.round(((color >> 16) & 255) * gain),
          Math.round(((color >> 8) & 255) * gain),
          Math.round((color & 255) * gain),
          255,
        ],
        index,
      );
      heights[y * edge + x] = Math.sin(u * Math.PI) * 0.3 + v * 0.12;
    }
  }
  for (let y = 0; y < edge; y++) {
    for (let x = 0; x < edge; x++) {
      const dx = heights[y * edge + ((x + edge - 1) % edge)] - heights[y * edge + ((x + 1) % edge)];
      const dy = heights[((y + edge - 1) % edge) * edge + x] - heights[((y + 1) % edge) * edge + x];
      const length = Math.hypot(dx, dy, 1);
      normals.set(
        [
          Math.round(((dx / length) * 0.5 + 0.5) * 255),
          Math.round(((dy / length) * 0.5 + 0.5) * 255),
          Math.round(((1 / length) * 0.5 + 0.5) * 255),
          255,
        ],
        (y * edge + x) * 4,
      );
    }
  }
  const texture = (pixels: Uint8Array, srgb = false) => {
    const map = new THREE.DataTexture(pixels, edge, edge, THREE.RGBAFormat);
    map.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.generateMipmaps = true;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.magFilter = THREE.LinearFilter;
    map.anisotropy = 8;
    map.needsUpdate = true;
    return map;
  };
  const material = new THREE.MeshStandardMaterial({
    map: texture(albedo, true),
    normalMap: texture(normals),
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: wet ? 0.4 : 0.78,
    metalness: 0.015,
  });
  material.name = `crafted-roof-${color.toString(16)}`;
  material.userData.facadeTexture = true;
  materials.set(color, material);
  return material;
}

export function updateRoofSurfaceWet(value: boolean): void {
  wet = value;
  for (const material of materials.values()) material.roughness = value ? 0.4 : 0.78;
}
