import * as THREE from 'three';

/** Two visual segments over one rigid physics limb. Writes into caller-owned
 * scratch vectors, so the crowd does not allocate additional joint objects. */
export function citizenLimbJoint(
  start: THREE.Vector3,
  end: THREE.Vector3,
  forward: THREE.Vector3,
  segmentLength: number,
  bend: number,
  joint: THREE.Vector3,
  scratch: THREE.Vector3,
): void {
  scratch.subVectors(end, start);
  const distance = scratch.length();
  if (distance < 1e-8) {
    joint.copy(start);
    return;
  }
  scratch.multiplyScalar(1 / distance);
  joint.copy(forward).addScaledVector(scratch, -forward.dot(scratch)).normalize();
  const height = Math.sqrt(Math.max(0, segmentLength ** 2 - (distance * 0.5) ** 2));
  joint
    .multiplyScalar(height * bend)
    .addScaledVector(start, 0.5)
    .addScaledVector(end, 0.5);
}

/** Shared PBR responses; per-person colours continue to use instanceColor. */
export function createCitizenMaterials() {
  return {
    cloth: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.63 }),
    hair: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78 }),
    leather: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.46 }),
  };
}

/** Heel, instep and rounded toe rings, with a flattened sole. Unit envelope is
 * retained so the existing foot targets and ground contact remain meaningful. */
export function createCitizenShoeGeometry(): THREE.BufferGeometry {
  const rings = [
    [-0.5, 0, -0.15],
    [-0.43, 0.27, 0.33],
    [-0.24, 0.34, 0.5],
    [0.02, 0.43, 0.29],
    [0.29, 0.45, 0.09],
    [0.44, 0.29, -0.04],
    [0.5, 0, -0.24],
  ];
  const positions: number[] = [],
    indices: number[] = [],
    segments = 10;
  for (const [z, width, top] of rings) {
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      positions.push(
        Math.cos(angle) * width,
        Math.min(top, Math.max(-0.5, (top - 0.5) / 2 + Math.sin(angle) * (top + 0.5) * 0.58)),
        z,
      );
    }
  }
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let i = 0; i < segments; i++) {
      const a = ring * (segments + 1) + i,
        b = a + segments + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
