import * as THREE from 'three';

const material = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.9,
  metalness: 0,
});
material.forceSinglePass = true;
material.name = 'meadow-flower-petals-and-leaves';

/** Compact octahedral petals curve around a contrasting centre. The whole drift
 * is baked once, including leaves/stems, then shared by every matching tile. */
function clusterGeometry(style: number): THREE.BufferGeometry {
  const positions: number[] = [],
    colors: number[] = [];
  const color = new THREE.Color();
  const triangles = [
    [0, 2, 4],
    [2, 1, 4],
    [1, 3, 4],
    [3, 0, 4],
    [2, 0, 5],
    [1, 2, 5],
    [3, 1, 5],
    [0, 3, 5],
  ];
  const shape = (
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    angle: number,
    tint: number,
  ) => {
    const c = Math.cos(angle),
      s = Math.sin(angle);
    const vertices = [
      [rx, 0, 0],
      [-rx, 0, 0],
      [0, 0, rz],
      [0, 0, -rz],
      [0, ry, 0],
      [0, -ry, 0],
    ];
    color.setHex(tint);
    for (const triangle of triangles)
      for (const index of [triangle[0], triangle[2], triangle[1]]) {
        const v = vertices[index];
        positions.push(x + v[0] * c - v[2] * s, y + v[1], z + v[0] * s + v[2] * c);
        colors.push(color.r, color.g, color.b);
      }
  };
  const palette = [
    [0xf1e8cc, 0xdab1c6],
    [0xe7c86e, 0xf1e8d7],
    [0xc6b7d8, 0xe8b7bb],
  ][style];
  const offsets = [
    [-0.061, -0.029],
    [0.018, -0.04],
    [-0.01, 0.033],
    [0.067, 0.021],
  ];
  for (let flower = 0; flower < offsets.length; flower++) {
    const [x, z] = offsets[flower],
      top = 0.036 + (flower % 3) * 0.009;
    const turn = style * 0.65 + flower * 1.27;
    // Thin soft stems and two pointed leaves read as plants, not a flat dot.
    shape(x, top / 2, z, 0.0025, top / 2, 0.0025, 0, 0x587c43);
    for (const side of [-1, 1]) {
      const angle = turn + (side < 0 ? Math.PI : 0);
      shape(
        x + Math.cos(angle) * 0.012,
        top * 0.38,
        z + Math.sin(angle) * 0.012,
        0.016,
        0.003,
        0.006,
        angle,
        side < 0 ? 0x739553 : 0x86a966,
      );
    }
    const petals = style === 1 ? 5 : 6;
    for (let petal = 0; petal < petals; petal++) {
      const angle = turn + (petal * Math.PI * 2) / petals;
      shape(
        x + Math.cos(angle) * 0.014,
        top,
        z + Math.sin(angle) * 0.014,
        0.015,
        0.004,
        0.0085,
        angle,
        palette[flower % 2],
      );
    }
    shape(x, top + 0.003, z, 0.009, 0.0045, 0.009, turn, style === 1 ? 0x996638 : 0xd8ab46);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.userData.flowerCount = offsets.length;
  geometry.userData.petalsPerFlower = style === 1 ? 5 : 6;
  return geometry;
}
const clusters = [0, 1, 2].map(clusterGeometry);

export function addMeadowFlowers(
  group: THREE.Group,
  x: number,
  z: number,
  seed: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(clusters[seed % clusters.length], material);
  mesh.name = 'meadow-flower-cluster';
  mesh.position.set(x, 0.029, z);
  mesh.rotation.y = (seed % 17) * 0.37;
  mesh.scale.setScalar(0.93 + (seed % 5) * 0.035);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.drivingSurface = true; // Soft plants never become solid obstacles.
  group.add(mesh);
  return mesh;
}
