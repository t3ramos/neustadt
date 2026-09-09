import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Source-local coordinates. Keep both the entrance axis and the effect canopy empty. */
export const LANDMARK_CANOPY_CLEARANCE = { minX: -0.22, maxX: 0.1, minZ: -0.28, maxZ: -0.07 };

/** Recover disconnected panes from the texture-free source, including welded GLB vertices. */
export function landmarkWindowBounds(source: THREE.Object3D): THREE.Box3[] {
  const panes: THREE.Box3[] = [];
  source.updateMatrixWorld(true);
  const inverse = source.matrixWorld.clone().invert();
  source.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh) ||
      Array.isArray(object.material) ||
      object.material.name !== 'Easter Egg glass'
    )
      return;
    const geometry = object.geometry;
    const positions = geometry.getAttribute('position');
    const parents = Array.from({ length: positions.count }, (_, i) => i);
    const root = (i: number): number => {
      while (parents[i] !== i) {
        parents[i] = parents[parents[i]];
        i = parents[i];
      }
      return i;
    };
    const join = (a: number, b: number) => {
      parents[root(a)] = root(b);
    };
    const transform = inverse.clone().multiply(object.matrixWorld);
    const points = Array.from({ length: positions.count }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(transform),
    );
    const welded = new Map<string, number>();
    points.forEach((p, i) => {
      const key = p
        .toArray()
        .map((v) => Math.round(v * 1e6))
        .join(',');
      const previous = welded.get(key);
      if (previous !== undefined) join(i, previous);
      else welded.set(key, i);
    });
    const index = geometry.index;
    for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
      const a = index ? index.getX(i) : i;
      join(a, index ? index.getX(i + 1) : i + 1);
      join(a, index ? index.getX(i + 2) : i + 2);
    }
    const boxes = new Map<number, THREE.Box3>();
    points.forEach((point, i) => {
      const id = root(i);
      if (!boxes.has(id)) boxes.set(id, new THREE.Box3());
      boxes.get(id)!.expandByPoint(point);
    });
    for (const box of boxes.values()) {
      const size = box.getSize(new THREE.Vector3());
      if (size.y > 0.025 && size.y < 0.18 && Math.max(size.x, size.z) < 0.16) panes.push(box);
    }
  });
  return panes;
}

/** Built once into the cached GLB template; no textures, lights, animation or per-tile resources. */
export function createLandmarkOfficeDetails(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Easter Egg architectural refinement';
  const palette = {
    charcoal: new THREE.MeshStandardMaterial({ color: 0x29383b, metalness: 0.3, roughness: 0.48 }),
    timber: new THREE.MeshStandardMaterial({ color: 0x78503a, roughness: 0.83 }),
    foliage: new THREE.MeshStandardMaterial({ color: 0x49764c, roughness: 0.92 }),
    leafTips: new THREE.MeshStandardMaterial({ color: 0x789354, roughness: 0.95 }),
    light: new THREE.MeshStandardMaterial({
      color: 0xffe2ad,
      emissive: 0xffc77d,
      emissiveIntensity: 0.65,
      roughness: 0.5,
    }),
  };
  type Finish = keyof typeof palette;
  const batches = new Map<Finish, THREE.BufferGeometry[]>();
  const add = (finish: Finish, geometry: THREE.BufferGeometry, x: number, y: number, z: number) => {
    geometry.translate(x, y, z);
    if (!batches.has(finish)) batches.set(finish, []);
    batches.get(finish)!.push(geometry);
  };
  const box = (finish: Finish, x: number, y: number, z: number, w: number, h: number, d: number) =>
    add(finish, new THREE.BoxGeometry(w, h, d).toNonIndexed(), x, y, z);
  const crown = (finish: Finish, x: number, y: number, z: number, r: number, sy = 1) => {
    const geometry = new THREE.IcosahedronGeometry(r, 1);
    geometry.scale(1, sy, 0.85);
    add(finish, geometry, x, y, z);
  };

  // The supplied GLB owns the entire white/grey facade, window grid, sign and entrance.
  // Official building photography does not support additional bronze trims or broad sun blades.
  // Retain only the explicitly accepted terrace planting; never dress or recolor the elevations.

  // Low terrace gardens stay below the existing roof silhouette and outside occupied furniture.
  for (const x of [0.36, 0.7, 1.04]) {
    box('charcoal', x, 0.845, 0.285, 0.25, 0.042, 0.085);
    for (let i = 0; i < 6; i++) box('timber', x - 0.1 + i * 0.04, 0.845, 0.33, 0.026, 0.033, 0.005);
    for (let i = 0; i < 4; i++)
      crown(i % 2 ? 'leafTips' : 'foliage', x - 0.087 + i * 0.058, 0.881, 0.285, 0.035, 0.7);
    box('light', x, 0.831, 0.335, 0.21, 0.004, 0.003);
  }
  for (const [finish, pieces] of batches) {
    const geometry = mergeGeometries(pieces);
    pieces.forEach((piece) => piece.dispose());
    if (!geometry) throw new Error(`Could not merge landmark ${finish}`);
    geometry.userData.easterEggShared = true;
    const material = palette[finish];
    material.name = `Easter Egg refinement ${finish}`;
    material.userData.easterEggShared = true;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Easter Egg detail ${finish}`;
    mesh.castShadow = finish !== 'light';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
