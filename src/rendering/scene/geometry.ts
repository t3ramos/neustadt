import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Merge each chunk by shared material; primitive source geometry remains reusable. */
export function batchGroup(source: THREE.Group): THREE.Group {
  const work = batchGroupSteps(source);
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}

/** Each transformed mesh is a scheduling boundary. Temporary geometries are
 * owned here and also released when a superseded job calls generator.return(). */
export function* batchGroupSteps(source: THREE.Group): Generator<void, THREE.Group> {
  source.updateMatrixWorld(true);
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>(),
    result = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  source.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  let completed = false;
  try {
    for (const object of meshes) {
      const material = Array.isArray(object.material) ? object.material[0] : object.material;
      const geometry = object.geometry.index
        ? object.geometry.toNonIndexed()
        : object.geometry.clone();
      for (const name of Object.keys(geometry.attributes))
        if (name !== 'position' && name !== 'normal' && name !== 'uv')
          geometry.deleteAttribute(name);
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      if (!geometry.getAttribute('uv'))
        geometry.setAttribute(
          'uv',
          new THREE.Float32BufferAttribute(
            new Float32Array(geometry.getAttribute('position').count * 2),
            2,
          ),
        );
      geometry.applyMatrix4(object.matrixWorld);
      geometry.clearGroups();
      const list = batches.get(material) ?? [];
      list.push(geometry);
      batches.set(material, list);
      yield;
    }
    for (const [material, geometries] of batches) {
      const geometry = mergeGeometries(geometries, false);
      for (const primitive of geometries) primitive.dispose();
      geometries.length = 0;
      if (geometry) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        result.add(mesh);
      }
      yield;
    }
    completed = true;
    return result;
  } finally {
    for (const geometries of batches.values())
      for (const geometry of geometries) geometry.dispose();
    if (!completed) disposeGroup(result);
  }
}

export function disposeGroup(group: THREE.Object3D) {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments)
      object.geometry.dispose();
  });
  group.removeFromParent();
}
