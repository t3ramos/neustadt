import * as THREE from 'three';
import { palette, modelMaterial } from './materials';
import { roofSurfaceMaterial } from './roof-surface';
export const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
export const coneGeometry = new THREE.ConeGeometry(0.5, 1, 7);
export const cylinderGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
export const sphereGeometry = new THREE.IcosahedronGeometry(0.5, 1);
export const crownGeometry = new THREE.IcosahedronGeometry(0.5, 0);
// Forest geometry is shared and instanced by the renderer. Smooth canopies have
// enough contour detail at street height without multiplying every forest tile
// into a high-poly asset (248–296 triangles per individual tree).
export const treeTrunkGeometry = new THREE.CylinderGeometry(0.36, 0.5, 1, 8);
export const treeBranchGeometry = new THREE.CylinderGeometry(0.22, 0.5, 1, 5);
export const treeCrownGeometry = new THREE.SphereGeometry(0.5, 10, 8);
export const treeCrownSmallGeometry = new THREE.SphereGeometry(0.5, 8, 6);
export const evergreenGeometry = new THREE.LatheGeometry(
  [
    new THREE.Vector2(0.05, 0),
    new THREE.Vector2(0.46, 0.04),
    new THREE.Vector2(0.38, 0.14),
    new THREE.Vector2(0.25, 0.26),
    new THREE.Vector2(0.38, 0.29),
    new THREE.Vector2(0.26, 0.42),
    new THREE.Vector2(0.15, 0.55),
    new THREE.Vector2(0.27, 0.58),
    new THREE.Vector2(0.14, 0.77),
    new THREE.Vector2(0, 1),
  ],
  12,
);
export const roofGeometry = new THREE.BufferGeometry();
// Gabled prism: ridge runs along local z. All dimensions are unit length.
roofGeometry.setAttribute(
  'position',
  new THREE.Float32BufferAttribute(
    [
      -0.5, 0, -0.5, 0, 1, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5, -0.5, 0, -0.5,
      0, 1, 0.5, 0, 1, -0.5, -0.5, 0, -0.5, -0.5, 0, 0.5, 0, 1, 0.5, 0, 1, -0.5, 0.5, 0, 0.5, 0.5,
      0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, -0.5,
      0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5,
    ],
    3,
  ),
);
roofGeometry.computeVertexNormals();
const roofPositions = roofGeometry.getAttribute('position');
const roofNormals = roofGeometry.getAttribute('normal');
const roofUv = new Float32Array(roofPositions.count * 2);
for (let vertex = 0; vertex < roofPositions.count; vertex++) {
  roofUv[vertex * 2] =
    roofNormals.getY(vertex) > 0.1
      ? roofPositions.getZ(vertex) + 0.5
      : roofPositions.getX(vertex) + 0.5;
  roofUv[vertex * 2 + 1] = roofPositions.getY(vertex);
}
roofGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(roofUv, 2));
export function mesh(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  color: number,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  ry = 0,
): THREE.Mesh {
  const result = new THREE.Mesh(geometry, modelMaterial(color));
  result.position.set(x, y, z);
  result.scale.set(sx, sy, sz);
  result.rotation.y = ry;
  result.castShadow = true;
  result.receiveShadow = true;
  group.add(result);
  return result;
}
export function box(
  g: THREE.Group,
  c: number,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  angle = 0,
): THREE.Mesh {
  return mesh(g, boxGeometry, c, x, y, z, w, h, d, angle);
}
export function cylinder(
  g: THREE.Group,
  c: number,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d = w,
): THREE.Mesh {
  return mesh(g, cylinderGeometry, c, x, y, z, w, h, d);
}
export function roof(
  g: THREE.Group,
  c: number,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  angle = 0,
): void {
  const result = mesh(g, roofGeometry, c, x, y, z, w, h, d, angle);
  result.material = roofSurfaceMaterial(c);
}
export function slab(g: THREE.Group, color = palette.concrete, width = 0.9, depth = 0.9): void {
  box(g, color, 0, 0.014, 0, width, 0.028, depth);
}
export function tree(g: THREE.Group, x: number, z: number, scale: number, variant = 0): void {
  const species = Math.abs(variant) % 4;
  const bark = species === 2 ? palette.cream : palette.trunk;
  mesh(g, treeTrunkGeometry, bark, x, 0.21 * scale, z, 0.064 * scale, 0.42 * scale, 0.064 * scale);
  if (species === 0) {
    // A continuous, rounded twelve-sided profile retains the layered silhouette
    // of a conifer rather than placing a pair of coarse cones on a stick.
    mesh(
      g,
      evergreenGeometry,
      palette.forest,
      x,
      0.17 * scale,
      z,
      0.44 * scale,
      0.69 * scale,
      0.44 * scale,
    );
    return;
  }
  const birch = species === 2;
  const branch = mesh(
    g,
    treeBranchGeometry,
    bark,
    x + 0.058 * scale,
    0.35 * scale,
    z + 0.025 * scale,
    0.027 * scale,
    0.2 * scale,
    0.027 * scale,
  );
  branch.rotation.z = -0.57;
  branch.rotation.x = 0.2;
  mesh(
    g,
    treeCrownGeometry,
    species === 1 ? palette.leaf : species === 2 ? palette.leafLight : palette.forest,
    x - 0.035 * scale,
    (birch ? 0.48 : 0.45) * scale,
    z - 0.006 * scale,
    (birch ? 0.34 : 0.38) * scale,
    (birch ? 0.57 : 0.49) * scale,
    (birch ? 0.35 : 0.41) * scale,
  );
  mesh(
    g,
    treeCrownSmallGeometry,
    species === 3 ? palette.leaf : palette.leafLight,
    x + 0.115 * scale,
    (birch ? 0.51 : 0.4) * scale,
    z + 0.06 * scale,
    0.22 * scale,
    (birch ? 0.39 : 0.34) * scale,
    0.28 * scale,
  );
  if (birch)
    for (const y of [0.15, 0.28])
      box(
        g,
        palette.trunk,
        x,
        y * scale,
        z + 0.027 * scale,
        0.038 * scale,
        0.018 * scale,
        0.009 * scale,
      );
}
export function ribbon(
  g: THREE.Group,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color = palette.glassDark,
): void {
  // Two long windows are enough to read as glazing without hundreds of tiny panes.
  box(g, color, x, y, z + d / 2 + 0.003, w * 0.77, h, 0.008);
  box(g, color, x + w / 2 + 0.003, y, z, 0.008, h, d * 0.76);
  box(g, color, x, y, z - d / 2 - 0.003, w * 0.77, h, 0.008);
}
export function rooftop(g: THREE.Group, x: number, y: number, z: number, width: number): void {
  box(g, palette.roof, x, y + 0.024, z, width, 0.048, width * 0.84);
  box(
    g,
    palette.metal,
    x - width * 0.17,
    y + 0.073,
    z - width * 0.15,
    width * 0.2,
    0.05,
    width * 0.24,
  );
}
export function zone(g: THREE.Group, color: number, variation: number): void {
  const light = new THREE.Color(color).lerp(new THREE.Color(palette.grass), 0.45).getHex();
  box(g, light, 0, 0.008, 0, 0.94, 0.016, 0.94);
  box(g, color, 0, 0.019, -0.455, 0.93, 0.009, 0.018);
  box(g, color, 0, 0.019, 0.455, 0.93, 0.009, 0.018);
  box(g, color, -0.455, 0.019, 0, 0.018, 0.009, 0.89);
  box(g, color, 0.455, 0.019, 0, 0.018, 0.009, 0.89);
  for (let n = 0; n < 3; n++) {
    box(g, color, (n - 1) * 0.2, 0.021, 0.02, 0.12, 0.012, 0.035);
  }
  if (variation % 4 === 0) tree(g, -0.3, -0.29, 0.36, 1);
}
