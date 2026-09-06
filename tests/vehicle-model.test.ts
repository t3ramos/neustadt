import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createDetailedCar, type VehicleKind } from '../src/vehicle-model.ts';

function meshes(car: THREE.Group): THREE.Mesh[] { return car.children as THREE.Mesh[]; }
function part(car: THREE.Group, name: string): THREE.Mesh { return car.getObjectByName(`vehicle-${name}`) as THREE.Mesh; }
const kinds: VehicleKind[] = ['sedan', 'taxi', 'van', 'truck'];

function dimensions(car: THREE.Group): THREE.Vector3 { return new THREE.Box3().setFromObject(car).getSize(new THREE.Vector3()); }

test('the detailed sedan preserves previous vehicle length, width, roof height, wheel contact, and forward axis', () => {
  const car = createDetailedCar(0xe5b34d);
  const bounds = new THREE.Box3().setFromObject(car), size = bounds.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - .183) < .0001, `Width ${size.x} must match existing car clearance`);
  assert.ok(Math.abs(size.z - .3385) < .0001, `Length ${size.z} must match existing car footprint`);
  assert.ok(Math.abs(bounds.min.y - .013) < .00001, `Wheel support plane ${bounds.min.y} changed`);
  assert.ok(Math.abs(bounds.max.y - .163) < .00001, `Roof height ${bounds.max.y} changed`);
  assert.equal(car.userData.vehicleForward, '+Z');
  assert.ok(part(car, 'headlights').geometry.boundingBox!.min.z > .15);
  const rearLights = part(car, 'taillights').geometry.boundingBox!;
  assert.ok(rearLights.max.z < -.03, 'All rear lamps, including the high brake light, must stay behind the cabin center');
  assert.ok(rearLights.min.z < -.15, 'The main rear lamps must remain at the rear bumper');
});

test('paint has a shaped three-dimensional hood and roof instead of a rectangular box silhouette', () => {
  const paint = part(createDetailedCar(0xc75948), 'paint').geometry;
  const positions = paint.getAttribute('position');
  const widths = new Map<string, number>();
  for (let i = 0; i < positions.count; i++) {
    if (positions.getY(i) > .101) continue;
    const z = positions.getZ(i).toFixed(4);
    widths.set(z, Math.max(widths.get(z) ?? 0, Math.abs(positions.getX(i))));
  }
  assert.ok(widths.size >= 8, 'Paint needs multiple longitudinal contour sections');
  const sections = [...widths].map(([z, width]) => ({ z: Number(z), width })).sort((a, b) => a.z - b.z);
  const bodyWidth = Math.max(...sections.map(section => section.width));
  const front = sections.filter(section => section.z > .155), rear = sections.filter(section => section.z < -.155);
  assert.ok(front.length > 0 && Math.max(...front.map(section => section.width)) < bodyWidth * .82, 'The nose should taper into the fenders');
  assert.ok(rear.length > 0 && Math.max(...rear.map(section => section.width)) < bodyWidth * .82, 'The rear bumper should taper too');
  assert.ok(new Set(Array.from({ length: positions.count }, (_, i) => positions.getY(i).toFixed(4))).size > 20);
});

test('four sedan tires have smooth round silhouettes, rounded tread, and exposed metal rims', () => {
  const car = createDetailedCar(0x708f9b);
  const positions = part(car, 'tires-and-trim').geometry.getAttribute('position');
  for (const x of [-.079, .079]) for (const z of [-.105, .105]) {
    const circlePoints = new Set<string>();
    const treadOffsets = new Set<string>();
    for (let i = 0; i < positions.count; i++) {
      const px = positions.getX(i), dy = positions.getY(i) - .039, dz = positions.getZ(i) - z;
      const radius = Math.hypot(dy, dz);
      if (Math.abs(px - x) <= .0126 && Math.abs(radius - .026) < .00005) circlePoints.add(`${dy.toFixed(6)},${dz.toFixed(6)}`);
      if (Math.abs(px - x) <= .0126 && radius > .024 && radius <= .02605) treadOffsets.add((px - x).toFixed(5));
    }
    assert.ok(circlePoints.size >= 24, `Wheel ${x},${z} has only ${circlePoints.size} outer profile vertices`);
    assert.ok(treadOffsets.size >= 3, `Wheel ${x},${z} needs a rounded tread cross-section`);
  }
  const rims = part(car, 'rims-and-metal');
  assert.ok((rims.material as THREE.MeshStandardMaterial).metalness > .6);
});

test('glass panes and paint face outward, are reflective, and require no transmission render pass', () => {
  const car = createDetailedCar(0xf3ede0), windows = part(car, 'windows');
  const positions = windows.geometry.getAttribute('position'), normals = windows.geometry.getAttribute('normal');
  let leftSide = 0, rightSide = 0, windshields = 0;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i), nx = normals.getX(i), ny = normals.getY(i);
    if (x < -.055 && Math.abs(z) < .080 && nx < -.6) leftSide++;
    if (x > .055 && Math.abs(z) < .080 && nx > .6) rightSide++;
    if (Math.abs(nx) < .01 && ny > .2 && Math.abs(z) > .03) windshields++;
  }
  assert.ok(leftSide >= 8 && rightSide >= 8, 'Both side-window sets must face their exterior side');
  assert.ok(windshields >= 8, 'Both inclined windscreens need outward upward normals');
  const glass = windows.material as THREE.MeshPhysicalMaterial;
  assert.ok(glass.roughness <= .12 && glass.clearcoat >= .9);
  assert.equal(glass.transmission, 0);
  const paint = part(car, 'paint').material as THREE.MeshPhysicalMaterial;
  assert.equal(paint.clearcoat, 1);
});

test('the opaque door shell never covers the central glass panes from either side', () => {
  const car = createDetailedCar(0xe5b34d); car.updateMatrixWorld(true);
  for (const side of [-1, 1]) for (const [y, z] of [[.105, .029], [.12, .02], [.13, .025], [.12, -.04], [.108, -.065]]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(side, y, z), new THREE.Vector3(-side, 0, 0));
    const hits = ray.intersectObject(car, true);
    assert.equal(hits[0]?.object.name, 'vehicle-windows', `Paint hides side ${side} glass at y=${y}, z=${z}`);
  }
});

test('fleet variants expose their own dimensions and collision envelopes, not uniformly enlarged sedans', () => {
  const fleet = Object.fromEntries(kinds.map(kind => [kind, createDetailedCar(0x708f9b, kind)])) as Record<VehicleKind, THREE.Group>;
  const sizes = Object.fromEntries(kinds.map(kind => [kind, dimensions(fleet[kind])])) as Record<VehicleKind, THREE.Vector3>;
  for (const kind of kinds) {
    const car = fleet[kind], bounds = new THREE.Box3().setFromObject(car), size = sizes[kind];
    const { vehicleDimensions: declared, collisionHalfWidth, collisionHalfLength } = car.userData;
    assert.equal(car.userData.vehicleKind, kind);
    assert.equal(car.userData.vehicleForward, '+Z');
    assert.ok(typeof car.userData.vehicleLabel === 'string' && car.userData.vehicleLabel.trim().length >= 3, `${kind} needs a readable vehicle label`);
    for (const field of ['width', 'length', 'height', 'wheelBase', 'mass']) assert.ok(Number.isFinite(declared[field]) && declared[field] > 0, `${kind}: invalid ${field}`);
    assert.ok(Math.abs(declared.width - size.x) < .003, `${kind} width metadata must fit its rendered geometry`);
    assert.ok(Math.abs(declared.length - size.z) < .003, `${kind} length metadata must fit its rendered geometry`);
    assert.ok(declared.height >= size.y - .001 && declared.height <= bounds.max.y + .02, `${kind} height metadata must include its roof`);
    assert.ok(declared.wheelBase < declared.length && declared.wheelBase > declared.length * .4);
    assert.ok(collisionHalfWidth >= Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)) - .0001, `${kind} width collision envelope is too small`);
    assert.ok(collisionHalfLength >= Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)) - .0001, `${kind} length collision envelope is too small`);
    assert.ok(collisionHalfWidth <= declared.width / 2 + .015 && collisionHalfLength <= declared.length / 2 + .015, `${kind} collision footprint needs to stay close to its visible body`);
    assert.deepEqual(car.scale.toArray(), [1, 1, 1]);
    assert.ok(part(car, 'headlights').geometry.boundingBox!.min.z > 0, `${kind} headlights must face forward`);
    assert.ok(part(car, 'taillights').geometry.boundingBox!.max.z < 0, `${kind} taillights must face backward`);
  }
  assert.ok(Math.abs(sizes.taxi.x - sizes.sedan.x) < .001 && Math.abs(sizes.taxi.z - sizes.sedan.z) < .001);
  assert.ok(new THREE.Box3().setFromObject(fleet.taxi).max.y >= .185, 'Taxi needs a raised roof sign');
  assert.ok(sizes.van.x > .195 && sizes.van.x < .22 && sizes.van.z > .36 && sizes.van.z < .41);
  assert.ok(sizes.truck.x > .22 && sizes.truck.x < .25 && sizes.truck.z > .54 && sizes.truck.z < .61);
  assert.ok(sizes.van.y / sizes.sedan.y > sizes.van.x / sizes.sedan.x + .2, 'The van needs its own tall cabin proportions');
  assert.ok(sizes.truck.z / sizes.truck.x > sizes.sedan.z / sizes.sedan.x + .4, 'The truck needs an independently extended chassis');
  assert.ok(fleet.truck.userData.vehicleDimensions.mass > fleet.van.userData.vehicleDimensions.mass);
  assert.ok(fleet.van.userData.vehicleDimensions.mass > fleet.sedan.userData.vehicleDimensions.mass);
  assert.notEqual(part(fleet.van, 'paint').geometry, part(fleet.sedan, 'paint').geometry);
  assert.notEqual(part(fleet.truck, 'paint').geometry, part(fleet.van, 'paint').geometry);
});

test('the truck has a forward cabin and an open rear cargo bed with visible floor and raised sides', () => {
  const truck = createDetailedCar(0xc75948, 'truck'); truck.updateMatrixWorld(true);
  const size = dimensions(truck);
  function topAt(x: number, z: number): number {
    const hit = new THREE.Raycaster(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0)).intersectObject(truck, true)[0];
    assert.ok(hit, `Truck surface missing at ${x},${z}`);
    return hit.point.y;
  }
  const cabin = topAt(0, size.z * .32);
  for (const rear of [-.15, -.28]) {
    const z = size.z * rear, floor = topAt(0, z), side = topAt(size.x * .43, z);
    assert.ok(cabin - floor > .075, 'A rear cargo floor must sit below the separate forward cabin');
    assert.ok(side - floor > .035, 'The open bed must have raised side walls');
  }
});

test('the truck rests on six tires across three distinct axles', () => {
  const truck = createDetailedCar(0x708f9b, 'truck');
  const tireGeometry = part(truck, 'tires-and-trim').geometry;
  const positions = tireGeometry.getAttribute('position');
  const ground = tireGeometry.boundingBox!.min.y;
  const leftAxles = new Set<string>(), rightAxles = new Set<string>();
  for (let i = 0; i < positions.count; i++) {
    if (Math.abs(positions.getY(i) - ground) > .00001) continue;
    const side = positions.getX(i) < 0 ? leftAxles : rightAxles;
    side.add(positions.getZ(i).toFixed(4));
  }
  assert.equal(leftAxles.size, 3, 'Left truck tires need three ground-contact profiles');
  assert.equal(rightAxles.size, 3, 'Right truck tires need three ground-contact profiles');
  assert.deepEqual([...leftAxles].sort(), [...rightAxles].sort(), 'Both sides must share the same axle positions');
});

test('100 mixed cars share variant geometry, isolated paint colors, and bounded draw and triangle budgets', () => {
  const cars = Array.from({ length: 100 }, (_, i) => createDetailedCar(Math.floor(i / kinds.length) % 2 ? 0xe5b34d : 0xc75948, kinds[i % kinds.length]));
  for (const kind of kinds) {
    const group = cars.filter(car => car.userData.vehicleKind === kind), first = group[0];
    assert.equal(group.length, 25);
    assert.ok(meshes(first).length >= 6 && meshes(first).length <= 8, `${kind} must batch its details into at most eight draw calls`);
    let triangles = 0;
    for (const mesh of meshes(first)) {
      triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
      for (const car of group) assert.equal((car.getObjectByName(mesh.name) as THREE.Mesh).geometry, mesh.geometry, `${kind}/${mesh.name} must reuse its variant cache`);
      assert.equal(mesh.castShadow, true); assert.equal(mesh.receiveShadow, true);
      const positions = mesh.geometry.getAttribute('position'), normals = mesh.geometry.getAttribute('normal');
      for (const value of positions.array) assert.ok(Number.isFinite(value));
      for (let vertex = 0; vertex < normals.count; vertex++) {
        const length = Math.hypot(normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex));
        assert.ok(length > .95 && length < 1.05, `Nonunit ${kind} geometry normal ${length}`);
      }
    }
    assert.ok(triangles >= 3000 && triangles <= 5000, `${kind}: ${triangles} triangles must provide curved detail within the fleet geometry budget`);
    assert.equal(part(first, 'paint').material, part(group[2], 'paint').material);
    assert.notEqual(part(first, 'paint').material, part(group[1], 'paint').material);
    assert.equal(part(first, 'windows').material, part(group[1], 'windows').material);
    assert.equal((part(first, 'paint').material as THREE.MeshStandardMaterial).color.getHex(), 0xc75948);
    assert.equal((part(group[1], 'paint').material as THREE.MeshStandardMaterial).color.getHex(), 0xe5b34d);
  }
  const paintByColor = new Map<number, THREE.Material>();
  for (const car of cars) {
    const paint = part(car, 'paint').material as THREE.MeshStandardMaterial, color = paint.color.getHex();
    if (paintByColor.has(color)) assert.equal(paint, paintByColor.get(color), 'Equal paint colors should share a material across variants');
    else paintByColor.set(color, paint);
  }
  assert.equal(paintByColor.size, 2);
});

test('delivery and freight cabins keep their curved side panes and front windscreens visibly ahead of paint', () => {
  for (const [kind, y, z] of [['van', .174, .083], ['truck', .209, .151]] as const) {
    const car = createDetailedCar(0xd1aa6b, kind); car.updateMatrixWorld(true);
    for (const side of [-1, 1]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(side, y, z), new THREE.Vector3(-side, 0, 0));
      assert.equal(ray.intersectObject(car, true)[0]?.object.name, 'vehicle-windows', `${kind} side ${side} window is covered by paint`);
    }
    const front = new THREE.Raycaster(new THREE.Vector3(0, y, 1), new THREE.Vector3(0, 0, -1));
    assert.equal(front.intersectObject(car, true)[0]?.object.name, 'vehicle-windows', `${kind} windscreen is covered by paint`);
  }
});


test('sedan fenders leave real circular wheel openings below the painted shoulders', () => {
  const car = createDetailedCar(0xd3aa70); car.updateMatrixWorld(true);
  const paint = part(car, 'paint');
  for (const side of [-1, 1]) for (const z of [-.105, .105]) {
    const opening = new THREE.Raycaster(new THREE.Vector3(side, .060, z), new THREE.Vector3(-side, 0, 0));
    const shoulder = new THREE.Raycaster(new THREE.Vector3(side, .082, z), new THREE.Vector3(-side, 0, 0));
    assert.equal(opening.intersectObject(paint).length, 0, `wheel ${side},${z} is covered by a solid painted side`);
    assert.ok(shoulder.intersectObject(paint).length > 0, `wheel ${side},${z} must retain its upper painted fender`);
  }
});
