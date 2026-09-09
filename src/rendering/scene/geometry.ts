import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

interface TriangleOwnerRange {
  start: number;
  end: number;
  anchor: number;
}

// CPU-only metadata follows each completed mesh's lifetime, including canceled
// chunks. No vertex attributes, material groups or per-frame traversal needed.
const triangleOwners = new WeakMap<THREE.Object3D, TriangleOwnerRange[]>();

/** Resolve Raycaster.faceIndex to its saved tile anchor; unowned hits fall back
 * to terrain/world-coordinate picking. Range ends are exclusive. */
export function getBatchTriangleOwner(
  object: THREE.Object3D,
  faceIndex: number | null | undefined,
): number | null {
  if (faceIndex == null || !Number.isSafeInteger(faceIndex) || faceIndex < 0) return null;
  const ranges = triangleOwners.get(object);
  if (!ranges) return null;
  let low = 0,
    high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1,
      range = ranges[middle];
    if (faceIndex < range.start) high = middle - 1;
    else if (faceIndex >= range.end) low = middle + 1;
    else return range.anchor;
  }
  return null;
}

function pickAnchor(object: THREE.Object3D, source: THREE.Object3D): number | null {
  for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
    const anchor: unknown = parent.userData.pickAnchor;
    if (typeof anchor === 'number' && Number.isSafeInteger(anchor) && anchor >= 0) return anchor;
    if (parent === source) break;
  }
  return null;
}

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
  const batches = new Map<
      THREE.Material,
      {
        geometries: THREE.BufferGeometry[];
        ranges: TriangleOwnerRange[];
        triangles: number;
      }
    >(),
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
      const batch = batches.get(material) ?? { geometries: [], ranges: [], triangles: 0 };
      const start = batch.triangles,
        end = start + geometry.getAttribute('position').count / 3,
        anchor = pickAnchor(object, source);
      if (anchor !== null && end > start) {
        const previous = batch.ranges.at(-1);
        if (previous?.anchor === anchor && previous.end === start) previous.end = end;
        else batch.ranges.push({ start, end, anchor });
      }
      batch.triangles = end;
      batch.geometries.push(geometry);
      batches.set(material, batch);
      yield;
    }
    for (const [material, { geometries, ranges }] of batches) {
      const geometry = mergeGeometries(geometries, false);
      for (const primitive of geometries) primitive.dispose();
      geometries.length = 0;
      if (geometry) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (ranges.length) triangleOwners.set(mesh, ranges);
        result.add(mesh);
      }
      yield;
    }
    completed = true;
    return result;
  } finally {
    for (const { geometries } of batches.values())
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
