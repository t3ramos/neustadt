import fs from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Box3, Mesh, Raycaster, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const file = new URL('../../public/assets/models/easter-egg-office.glb', import.meta.url);
const bytes = fs.readFileSync(file);
const jsonLength = bytes.readUInt32LE(12);
const metadata = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
for (const category of ['nodes', 'meshes', 'materials', 'scenes']) {
  for (const item of metadata[category] ?? [])
    assert.ok(item.name === 'Scene' || item.name?.startsWith('Easter Egg'), 'Neutral asset names');
}
const binaryOffset = 20 + jsonLength;
const binaryLength = bytes.readUInt32LE(binaryOffset);
const binaryGeometrySHA256 = createHash('sha256')
  .update(bytes.subarray(binaryOffset + 8, binaryOffset + 8 + binaryLength))
  .digest('hex');
const assetSHA256 = createHash('sha256').update(bytes).digest('hex');
const model = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  '',
);
const box = new Box3().setFromObject(model.scene);
let triangles = 0;
let meshes = 0;
const materials = new Set();
model.scene.traverse((o) => {
  if (o instanceof Mesh) {
    meshes++;
    triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    materials.add(o.material);
    assert.ok(o.geometry.attributes.normal);
  }
});
assert.ok(box.min.y >= -1e-6);
assert.ok(box.max.y < 1.05);
assert.ok(box.min.x >= -1.4 && box.max.x <= 1.4);
assert.ok(box.min.z >= -0.55 && box.max.z <= 0.6);
assert.ok(triangles < 30000);
assert.equal(meshes, 10);
assert.equal(materials.size, 10);
assert.ok(bytes.byteLength < 1600000);
// The actual shipped GLB must have glazing on all four elevations, not only a shell.
model.scene.updateMatrixWorld(true);
const facades = [
  { name: 'front', origin: new Vector3(-0.75, 0.4, 2), direction: new Vector3(0, 0, -1) },
  { name: 'rear', origin: new Vector3(-0.75, 0.4, -2), direction: new Vector3(0, 0, 1) },
  { name: 'left', origin: new Vector3(-2, 0.4, 0), direction: new Vector3(1, 0, 0) },
  { name: 'right', origin: new Vector3(2, 0.4, 0), direction: new Vector3(-1, 0, 0) },
];
for (const facade of facades) {
  const hit = new Raycaster(facade.origin, facade.direction).intersectObject(model.scene, true)[0];
  assert.ok(hit, `Closed ${facade.name} elevation`);
}
const glass = [];
model.scene.traverse((o) => {
  if (o instanceof Mesh && o.material.name === 'Easter Egg glass') {
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++)
      glass.push(new Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
  }
});
assert.ok(
  glass.some((v) => v.z > 0.38),
  'Street facade glazing retained',
);
assert.ok(
  glass.some((v) => v.z < -0.38),
  'Rear glazing completed',
);
assert.ok(
  glass.some((v) => v.x > 1.28),
  'Far side glazing completed',
);
assert.ok(
  glass.some((v) => v.x < -1.25),
  'Original terrace-end glazing retained',
);
// Original amber wordmark appears once, high on the street facade and below the roofline.
model.scene.traverse((o) => {
  if (o instanceof Mesh && o.material.name === 'Easter Egg amber') {
    assert.ok(Math.abs(o.material.color.r - 0.9130986333) < 1e-6);
    assert.ok(Math.abs(o.material.color.g - 0.3371636271) < 1e-6);
    const logo = new Box3().setFromObject(o);
    assert.ok(logo.min.z > 0.43);
    assert.ok(logo.min.y > 0.62);
    assert.ok(logo.max.y < 0.805);
    assert.ok(logo.max.x < 0.2 && logo.min.x > -0.2);
  }
});
// Roof zoning: solar at left, occupied terrace at right, cover separating them.
const byMaterial = (name) => {
  let result;
  model.scene.traverse((o) => {
    if (o instanceof Mesh && o.material.name === name) result = o;
  });
  return result;
};
const solar = byMaterial('Easter Egg solar');
const deck = byMaterial('Easter Egg deck');
const roofGlass = byMaterial('Easter Egg roof-glass');
assert.ok(solar instanceof Mesh && deck instanceof Mesh && roofGlass instanceof Mesh);
const solarBounds = new Box3().setFromObject(solar);
const deckBounds = new Box3().setFromObject(deck);
assert.ok(solarBounds.max.x < -0.4 && solarBounds.min.y > 0.83, 'Solar racks left on roof');
assert.ok(deckBounds.min.x > 0.13 && deckBounds.min.y > 0.8, 'Furnished terrace right on roof');
assert.ok(
  roofGlass.material.transparent && roofGlass.material.opacity < 0.5,
  'Transparent roof glazing',
);
const roofHeight = (x, z) =>
  new Raycaster(new Vector3(x, 2, z), new Vector3(0, -1, 0))
    .intersectObject(model.scene, true)
    .find((hit) => hit.object !== roofGlass)?.point.y;
const canopyHeights = [
  [-0.22, -0.28],
  [0.1, -0.28],
  [-0.22, -0.07],
  [0.1, -0.07],
].map(([x, z]) => roofHeight(x, z));
assert.ok(
  canopyHeights.every((y) => y > 0.95 && y < 0.97),
  'Empty canopy roof has consistent height',
);
assert.ok(roofHeight(-0.1, 0.15) < 0.82, 'Front half remains uncovered');
const rayHit = (origin, direction) =>
  new Raycaster(new Vector3(...origin), new Vector3(...direction)).intersectObject(
    model.scene,
    true,
  )[0];
const rearWindow = rayHit([-0.956 * 0.59, 0.686 * 0.59, -2], [0, 0, 1]);
const rearPier = rayHit([-0.9 * 0.59, 0.686 * 0.59, -2], [0, 0, 1]);
assert.equal(rearWindow.object.material.name, 'Easter Egg glass');
assert.ok(
  rearWindow.point.z > rearPier.point.z + 0.008,
  'Rear glazing is actually behind the outer wall plane',
);
const endWindow = rayHit([2, 0.686 * 0.59, 0.543 * 0.59], [-1, 0, 0]);
const endPier = rayHit([2, 0.686 * 0.59, 0.49 * 0.59], [-1, 0, 0]);
assert.equal(endWindow.object.material.name, 'Easter Egg glass');
assert.ok(endWindow.point.x < endPier.point.x - 0.008, 'End glazing is actually recessed');
const furniture = byMaterial('Easter Egg furniture-wood');
assert.ok(
  furniture instanceof Mesh &&
    furniture.material.color.r < 0.1 &&
    furniture.material.color.g < 0.05,
  'Dark rustic wood furniture',
);
const furnitureBounds = new Box3().setFromObject(furniture);
assert.ok(furnitureBounds.min.y > 0.824, 'Furniture feet rest on deck surface');
const report = {
  recessedGlazing: {
    rearDepth: rearWindow.point.z - rearPier.point.z,
    endDepth: endPier.point.x - endWindow.point.x,
  },
  rooftop: {
    canopyHeights,
    solarBounds: { min: solarBounds.min.toArray(), max: solarBounds.max.toArray() },
    terraceBounds: { min: deckBounds.min.toArray(), max: deckBounds.max.toArray() },
  },
  assetSHA256,
  binaryGeometrySHA256,
  bytes: bytes.byteLength,
  meshes,
  materials: materials.size,
  triangles,
  bounds: { min: box.min.toArray(), max: box.max.toArray() },
};
fs.writeFileSync(
  new URL('../../output/easter-egg-assets/gltf-verification.json', import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(report);
