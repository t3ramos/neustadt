import * as THREE from 'three';

type Batch = { mesh: THREE.InstancedMesh; sources: THREE.Mesh[] };

/** Draw moving vehicle/facility parts once per shared geometry and material.
 * Raw roots remain visible, with their original children, for physics, picking
 * and animation. They are detached only from the identity render parent; this
 * owner explicitly updates world matrices before copying them to GPU instances.
 * Shared source geometry/materials are borrowed and never disposed here. */
export function createLiveInstances(parent: THREE.Group) {
  const group = new THREE.Group();
  group.name = 'live-instance-batches';
  parent.add(group);
  let roots: THREE.Group[] = [];
  let batches: Batch[] = [];
  let membership = '';
  let revision = 0;
  let sourceMeshes = 0;
  let visibleInstances = 0;
  const supported = (root: THREE.Group) => {
    let valid = true;
    root.traverse((object) => {
      if (!(object instanceof THREE.Group) && !(object instanceof THREE.Mesh)) valid = false;
      if (object instanceof THREE.SkinnedMesh || object instanceof THREE.InstancedMesh)
        valid = false;
    });
    return valid;
  };
  const visible = (object: THREE.Object3D) => {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (!current.visible) return false;
      current = current.parent;
    }
    return true;
  };
  function releaseBatches() {
    for (const batch of batches) {
      batch.mesh.removeFromParent();
      batch.mesh.dispose();
    }
    batches = [];
  }
  function synchronize(next: readonly THREE.Group[]): boolean {
    const key = next.map((root) => root.id).join(',');
    const changed = key !== membership;
    if (changed) {
      membership = key;
      revision++;
      releaseBatches();
      roots = next.filter(supported);
      const byKey = new Map<string, THREE.Mesh[]>();
      sourceMeshes = 0;
      for (const root of roots) {
        root.removeFromParent();
        root.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          const batchKey = `${object.geometry.uuid}:${materials.map((material) => material.uuid).join(',')}:${object.castShadow}:${object.receiveShadow}:${object.renderOrder}:${object.userData.ambientOcclusionExclude === true}`;
          const sources = byKey.get(batchKey) ?? [];
          sources.push(object);
          byKey.set(batchKey, sources);
          sourceMeshes++;
        });
      }
      for (const sources of byKey.values()) {
        const source = sources[0];
        const mesh = new THREE.InstancedMesh(source.geometry, source.material, sources.length);
        mesh.name = `live-instances:${source.name || source.geometry.type}`;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = source.castShadow;
        mesh.receiveShadow = source.receiveShadow;
        mesh.renderOrder = source.renderOrder;
        mesh.userData.ambientOcclusionExclude = source.userData.ambientOcclusionExclude;
        mesh.userData.liveInstanceBatch = true;
        group.add(mesh);
        batches.push({ mesh, sources });
      }
    }
    for (const root of roots) root.updateMatrixWorld(true);
    visibleInstances = 0;
    for (const { mesh, sources } of batches) {
      let index = 0;
      for (const source of sources) {
        if (!visible(source)) continue;
        mesh.setMatrixAt(index++, source.matrixWorld);
      }
      mesh.count = index;
      mesh.visible = index > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      visibleInstances += index;
    }
    return changed;
  }
  return {
    group,
    synchronize,
    diagnostics: () => ({
      roots: roots.length,
      sourceMeshes,
      batches: batches.length,
      visibleInstances,
      revision,
    }),
    dispose() {
      releaseBatches();
      roots = [];
      group.removeFromParent();
    },
  };
}
