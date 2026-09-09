import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCitizens } from '../../src/citizens/system.ts';
import { createCity } from '../../src/simulation/city-simulation.ts';

function fixture() {
  const state = createCity(91, true, 40);
  for (const tile of state.tiles) {
    tile.kind = 'empty';
    tile.elevation = 1;
    tile.anchor = -1;
    tile.level = 0;
  }
  for (let x = 5; x < 20; x++) {
    state.tiles[10 * state.size + x].kind = 'road';
    state.tiles[11 * state.size + x].kind = 'residential';
    state.tiles[11 * state.size + x].level = 2;
  }
  // Includes actor 3 and actor 123, exercising reuse within each emblem batch.
  state.stats.population = 4000;
  state.revision++;
  return createCitizens(state);
}

function batch(system: ReturnType<typeof createCitizens>, name: string) {
  const mesh = system.group.getObjectByName(`citizen-${name}`);
  assert.ok(mesh instanceof THREE.InstancedMesh, name);
  return mesh;
}

function matrix(mesh: THREE.InstancedMesh, index: number) {
  const result = new THREE.Matrix4();
  mesh.getMatrixAt(index, result);
  assert.ok(result.elements.every(Number.isFinite), `${mesh.name} matrix must be finite`);
  return result;
}

function closeMatrix(actual: THREE.Matrix4, expected: THREE.Matrix4, label: string) {
  actual.elements.forEach((value, i) => {
    assert.ok(Math.abs(value - expected.elements[i]) < 2e-5, `${label}: component ${i}`);
  });
}

test('actual crowd selects actor 3 red sweater and two stamps, suppressing only its shirt trim', () => {
  const system = fixture();
  try {
    const actors = system.getDebug().positions;
    assert.ok(actors.some((actor) => actor.id === 3));
    assert.ok(actors.some((actor) => actor.id === 123));
    const details = system.group.children.filter(
      (object) => object instanceof THREE.InstancedMesh && object.name.startsWith('citizen-'),
    );
    assert.equal(details.length, 33, 'two emblem batches bring detailed crowd budget to 33');
    const red = new THREE.Color(0xe51b23),
      black = new THREE.Color(0x080808);
    actors.forEach((actor, index) => {
      const heritage = actor.id % 120 === 3;
      for (const name of ['eagleFront', 'eagleBack']) {
        const mesh = batch(system, name);
        assert.equal(mesh.count, actors.length);
        const transform = matrix(mesh, index);
        if (heritage) {
          assert.ok(transform.determinant() > 0, `${name} must be visible without reflection`);
          const color = new THREE.Color();
          mesh.getColorAt(index, color);
          assert.ok(color.toArray().every((v, i) => Math.abs(v - black.toArray()[i]) < 1e-6));
        } else {
          assert.deepEqual(new THREE.Vector3().setFromMatrixScale(transform).toArray(), [0, 0, 0]);
        }
      }
      if (!heritage) return;
      for (const name of [
        'torso',
        'leftArm',
        'rightArm',
        'leftForeArm',
        'rightForeArm',
        'leftCuff',
        'rightCuff',
      ]) {
        const color = new THREE.Color();
        batch(system, name).getColorAt(index, color);
        assert.ok(
          color.toArray().every((v, i) => Math.abs(v - red.toArray()[i]) < 1e-6),
          `${name} is sweater red`,
        );
        assert.ok(matrix(batch(system, name), index).determinant() > 0);
      }
      for (const name of ['shirtFront', 'collar', 'garmentDetails']) {
        assert.deepEqual(
          new THREE.Vector3().setFromMatrixScale(matrix(batch(system, name), index)).toArray(),
          [0, 0, 0],
          `${name} hidden on sweater`,
        );
      }
    });
    const ordinaryShirt = actors.findIndex((actor) => actor.id === 6);
    for (const name of ['shirtFront', 'collar', 'garmentDetails'])
      assert.ok(
        matrix(batch(system, name), ordinaryShirt).determinant() > 0,
        `${name} remains on ordinary shirt`,
      );
  } finally {
    system.dispose();
  }
});

test('wrapped stamps face outward and remain torso-attached while face details animate finitely', () => {
  const system = fixture();
  try {
    const index = system.getDebug().positions.findIndex((actor) => actor.id === 3);
    const torso = batch(system, 'torso');
    const front = batch(system, 'eagleFront'),
      back = batch(system, 'eagleBack');
    assert.notEqual(
      front.geometry,
      back.geometry,
      'front and back have separately wrapped contours',
    );
    const relatives = [front, back].map((mesh) =>
      matrix(torso, index).invert().multiply(matrix(mesh, index)),
    );
    const originals = [front, back].map((mesh) =>
      Array.from(mesh.geometry.getAttribute('position').array),
    );
    for (const [mesh, sign] of [
      [front, 1],
      [back, -1],
    ] as const) {
      const geometry = mesh.geometry;
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      assert.ok([...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite));
      assert.ok(Math.abs(box.min.x + 0.043) < 1e-6 && Math.abs(box.max.x - 0.043) < 1e-6);
      assert.ok(Math.abs(box.min.y + 0.043) < 1e-6 && Math.abs(box.max.y - 0.053) < 1e-6);
      assert.ok(sign === 1 ? box.min.z > 0 : box.max.z < 0);
      assert.ok(box.max.z - box.min.z > 0.001, 'stamp follows curved sweater');
      const p = geometry.getAttribute('position'),
        n = geometry.getAttribute('normal');
      assert.equal(p.count % 3, 0);
      assert.ok(Array.from(p.array).every(Number.isFinite));
      assert.ok(Array.from(n.array).every(Number.isFinite));
      for (let i = 0; i < p.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(p, i);
        const b = new THREE.Vector3().fromBufferAttribute(p, i + 1).sub(a);
        const c = new THREE.Vector3().fromBufferAttribute(p, i + 2).sub(a);
        assert.ok(b.cross(c).z * sign > 0, 'every triangle winds outward');
        assert.ok(n.getZ(i) * sign > 0, 'normal faces outward');
      }
    }
    const initialTorso = matrix(torso, index);
    const faces = ['head', 'leftEye', 'rightEye', 'brows', 'nose', 'mouth'];
    for (let frame = 0; frame < 60; frame++) {
      system.animate(1 / 30, true);
      [front, back].forEach((mesh, side) => {
        closeMatrix(
          matrix(torso, index).invert().multiply(matrix(mesh, index)),
          relatives[side],
          'torso-relative stamp',
        );
      });
      for (const name of faces) {
        const mesh = batch(system, name);
        const transform = matrix(mesh, index);
        assert.ok(transform.determinant() > 0, `${name} remains visible`);
        const positions = mesh.geometry.getAttribute('position');
        for (let vertex = 0; vertex < positions.count; vertex++) {
          const world = new THREE.Vector3()
            .fromBufferAttribute(positions, vertex)
            .applyMatrix4(transform);
          assert.ok(world.toArray().every(Number.isFinite), `${name} animated vertex`);
        }
      }
    }
    assert.notDeepEqual(
      matrix(torso, index).elements,
      initialTorso.elements,
      'attachment checked during actual motion',
    );
    [front, back].forEach((mesh, side) => {
      assert.deepEqual(
        Array.from(mesh.geometry.getAttribute('position').array),
        originals[side],
        'animation does not mutate shared stamp vertices',
      );
    });
  } finally {
    system.dispose();
  }
});

test('shared crowd detail geometries survive animation and each dispose exactly once', () => {
  const system = fixture();
  const geometries = new Set<THREE.BufferGeometry>();
  system.group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh && object.name.startsWith('citizen-'))
      geometries.add(object.geometry);
  });
  assert.equal(batch(system, 'leftEye').geometry, batch(system, 'rightEye').geometry);
  assert.equal(batch(system, 'leftArm').geometry, batch(system, 'rightArm').geometry);
  const disposals = new Map([...geometries].map((geometry) => [geometry, 0]));
  for (const geometry of geometries)
    geometry.addEventListener('dispose', () =>
      disposals.set(geometry, disposals.get(geometry)! + 1),
    );
  try {
    system.animate(1 / 30, true);
    assert.ok([...disposals.values()].every((count) => count === 0));
  } finally {
    system.dispose();
  }
  for (const [geometry, count] of disposals)
    assert.equal(count, 1, `shared geometry ${geometry.uuid} disposed exactly once`);
});
