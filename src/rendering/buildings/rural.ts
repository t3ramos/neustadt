import * as THREE from 'three';
import type { Tile } from '../../domain/types';
import { buildingVariant, zoneLotDimensions } from '../../buildings/lots';

/** Low-poly agricultural businesses; animal bodies, heads and legs use three instanced draw calls. */
export function buildRuralCommercial(tile: Tile): THREE.Group {
  const group = new THREE.Group();
  group.name = 'rural-commercial';
  const [w, d] = zoneLotDimensions(tile),
    variant = buildingVariant(tile),
    cx = (w - 1) / 2,
    cz = (d - 1) / 2;
  const palette = {
    soil: 0x927753,
    grass: 0x859b57,
    crop: 0xb6ac5e,
    wall: [0x976a50, 0xb6a184, 0x82775d, 0x8b4f3f, 0xbab09a][variant],
    roof: 0x555a56,
    wood: 0x8d785b,
    door: 0x464941,
  };
  const materials = new Map<number, THREE.MeshStandardMaterial>();
  const mat = (color: number) => {
    let m = materials.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.94 });
      materials.set(color, m);
    }
    return m;
  };
  const box = (
    name: string,
    color: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat(color));
    m.name = name;
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  box('farm-meadow', palette.grass, cx, 0.012, cz, w - 0.1, 0.024, d - 0.1);
  const bw = w === 3 ? 1.12 : 0.88,
    bd = 0.7,
    bx = -0.38 + bw / 2,
    bz = -0.34 + bd / 2,
    height = 0.48 + variant * 0.035;
  box('barn-wall', palette.wall, bx, height / 2, bz, bw, height, bd);
  // Two explicit roof slopes give the barn a recognizable gable from every camera angle.
  for (const side of [-1, 1]) {
    const roof = box(
      'barn-gabled-roof',
      palette.roof,
      bx,
      height + 0.13,
      bz + side * 0.19,
      bw + 0.1,
      0.055,
      0.47,
    );
    roof.rotation.x = side * -0.53;
  }
  box('barn-wide-door', palette.door, bx, 0.2, bz + bd / 2 + 0.008, bw * 0.42, 0.4, 0.025);
  for (const side of [-1, 1])
    box('barn-window', 0xbac6b3, bx + side * bw * 0.32, 0.32, bz + bd / 2 + 0.02, 0.13, 0.12, 0.03);
  const fieldX = w === 3 ? 1.65 : 0.95,
    fieldW = w === 3 ? 1.42 : 0.8;
  box('tilled-field', palette.soil, fieldX, 0.035, cz, fieldW, 0.025, d - 0.23);
  const cropGeometry = new THREE.BoxGeometry(1, 1, 1),
    cropRows = new THREE.InstancedMesh(
      cropGeometry,
      mat(variant === 1 ? 0x90a469 : palette.crop),
      5,
    ),
    dummy = new THREE.Object3D();
  cropRows.name = 'crop-rows';
  for (let i = 0; i < 5; i++) {
    dummy.position.set(fieldX, 0.095, -0.3 + (i * (d - 0.4)) / 5);
    dummy.scale.set(fieldW - 0.08, 0.085, 0.06);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    cropRows.setMatrixAt(i, dummy.matrix);
  }
  cropRows.castShadow = true;
  group.add(cropRows);
  // Small livestock pasture sits in front of the barn. Shared geometry keeps each herd cheap.
  const count = 2 + (variant % 3),
    animals: Array<{ x: number; z: number; s: number }> = [];
  for (let i = 0; i < count; i++)
    animals.push({
      x: -0.23 + (i % 2) * 0.37,
      z: 0.74 + Math.floor(i / 2) * 0.32,
      s: variant === 2 ? 0.85 : 1,
    });
  const animalMat = mat(variant === 2 ? 0xd9d5c5 : 0xe3dfce),
    dark = mat(0x4b4941);
  function herdPart(
    name: string,
    material: THREE.Material,
    partsPerAnimal: number,
    place: (animal: (typeof animals)[number], part: number) => void,
  ) {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      material,
      count * partsPerAnimal,
    );
    mesh.name = name;
    let index = 0;
    for (const a of animals)
      for (let p = 0; p < partsPerAnimal; p++) {
        place(a, p);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(index++, dummy.matrix);
      }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  herdPart('livestock-bodies', animalMat, 1, (a) => {
    dummy.position.set(a.x, 0.18, a.z);
    dummy.scale.set(0.25 * a.s, 0.13 * a.s, 0.12 * a.s);
  });
  herdPart('livestock-heads', dark, 1, (a) => {
    dummy.position.set(a.x + 0.14 * a.s, 0.21, a.z);
    dummy.scale.set(0.08 * a.s, 0.09 * a.s, 0.095 * a.s);
  });
  herdPart('livestock-legs', dark, 4, (a, p) => {
    dummy.position.set(
      a.x + (p % 2 ? 1 : -1) * 0.075 * a.s,
      0.075,
      a.z + (p < 2 ? 1 : -1) * 0.039 * a.s,
    );
    dummy.scale.set(0.025, 0.13, 0.025);
  });
  for (const z of [0.54, d - 0.55]) {
    box('pasture-rail', palette.wood, 0.12, 0.18, z, 0.98, 0.035, 0.035);
    for (const x of [-0.35, 0.57])
      box('pasture-post', palette.wood, x, 0.14, z, 0.045, 0.28, 0.045);
  }
  if (variant === 1 || variant === 4) {
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.63, 8), mat(0xacae9f));
    silo.name = 'farm-silo';
    silo.position.set(bx + bw / 2 + 0.13, 0.315, bz - 0.1);
    silo.castShadow = true;
    group.add(silo);
  }
  group.userData.ruralCommercial = true;
  group.userData.animalCount = count;
  group.userData.variant = variant;
  return group;
}
