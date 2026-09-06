import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PathTracingSceneGenerator } from 'three-gpu-pathtracer';
import { createPathTracingSnapshot, getPathTracingSettings } from '../src/raytracing.ts';

const meshesIn = (scene: THREE.Scene) => scene.children.filter((object): object is THREE.Mesh => object instanceof THREE.Mesh);

function near(actual: number, expected: number, message: string) {
  assert.ok(Math.abs(actual - expected) < 1e-5, `${message}: expected ${expected}, received ${actual}`);
}

function triangle() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.computeVertexNormals();
  return geometry;
}

test('snapshot expands instances into world space, including parent transforms and nonuniform scales', async () => {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  parent.position.set(11, 3, -4);
  parent.rotation.y = Math.PI / 3;
  parent.scale.set(1.5, 2, 0.75);
  scene.add(parent);

  const geometry = triangle();
  const material = new THREE.MeshStandardMaterial();
  const instances = new THREE.InstancedMesh(geometry, material, 2);
  instances.position.set(-2, 1, 4);
  instances.rotation.z = Math.PI / 6;
  parent.add(instances);
  const instanceTransforms = [
    new THREE.Matrix4().makeTranslation(2, 0, -3),
    new THREE.Matrix4().compose(new THREE.Vector3(-1, 2, 3), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(2, 1, 0.5)),
  ];
  instanceTransforms.forEach((matrix, index) => instances.setMatrixAt(index, matrix));
  const originalPositions = Array.from(geometry.getAttribute('position').array);
  const originalMatrices = Array.from(instances.instanceMatrix.array);

  const snapshot = await createPathTracingSnapshot(scene);
  try {
    const [mesh] = meshesIn(snapshot.scene);
    assert.equal(meshesIn(snapshot.scene).length, 1);
    assert.equal(mesh instanceof THREE.InstancedMesh, false, 'Photo geometry must not retain unsupported instances');
    const positions = mesh.geometry.getAttribute('position');
    assert.equal(positions.count, 6);
    const actual = new THREE.Vector3();
    const expected = new THREE.Vector3();
    for (let instance = 0; instance < 2; instance++) {
      for (let vertex = 0; vertex < 3; vertex++) {
        expected.fromBufferAttribute(geometry.getAttribute('position'), vertex).applyMatrix4(instanceTransforms[instance]).applyMatrix4(instances.matrixWorld);
        actual.fromBufferAttribute(positions, instance * 3 + vertex).applyMatrix4(mesh.matrixWorld);
        near(actual.x, expected.x, 'World x');
        near(actual.y, expected.y, 'World y');
        near(actual.z, expected.z, 'World z');
      }
    }
    assert.deepEqual(Array.from(geometry.getAttribute('position').array), originalPositions);
    assert.deepEqual(Array.from(instances.instanceMatrix.array), originalMatrices);
  } finally {
    snapshot.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('snapshot multiplies instance tint by existing vertex colors without changing live buffers or material', async () => {
  const scene = new THREE.Scene();
  const geometry = triangle();
  const originalColors = [0.8, 0.4, 0.2, 0.6, 0.2, 1, 0.4, 1, 0.6];
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(originalColors, 3));
  const material = new THREE.MeshStandardMaterial({ color: 0xc8ae88, vertexColors: false });
  const instances = new THREE.InstancedMesh(geometry, material, 2);
  const tints = [new THREE.Color(0.5, 0.25, 1), new THREE.Color(1, 0.5, 0.2)];
  tints.forEach((tint, index) => {
    instances.setColorAt(index, tint);
    instances.setMatrixAt(index, new THREE.Matrix4().makeTranslation(index * 3, 0, 0));
  });
  scene.add(instances);
  const liveColors = Array.from(geometry.getAttribute('color').array);
  const liveInstanceColors = Array.from(instances.instanceColor!.array);
  const liveMaterialColor = material.color.clone();

  const snapshot = await createPathTracingSnapshot(scene);
  try {
    const [mesh] = meshesIn(snapshot.scene);
    const colors = mesh.geometry.getAttribute('color');
    assert.equal(colors.count, 6);
    assert.equal((mesh.material as THREE.MeshStandardMaterial).vertexColors, true);
    for (let instance = 0; instance < 2; instance++) {
      for (let vertex = 0; vertex < 3; vertex++) {
        near(colors.getX(instance * 3 + vertex), liveColors[vertex * 3] * tints[instance].r, 'Red tint');
        near(colors.getY(instance * 3 + vertex), liveColors[vertex * 3 + 1] * tints[instance].g, 'Green tint');
        near(colors.getZ(instance * 3 + vertex), liveColors[vertex * 3 + 2] * tints[instance].b, 'Blue tint');
      }
    }
    assert.deepEqual(Array.from(geometry.getAttribute('color').array), liveColors);
    assert.deepEqual(Array.from(instances.instanceColor!.array), liveInstanceColors);
    assert.equal(material.vertexColors, false);
    assert.ok(material.color.equals(liveMaterialColor));
  } finally {
    snapshot.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('snapshot excludes hidden ancestors, excluded HUD subtrees, and empty instance batches', async () => {
  const scene = new THREE.Scene();
  const geometry = triangle();
  const material = new THREE.MeshStandardMaterial();
  const visible = new THREE.Mesh(geometry, material);
  visible.position.x = 7;
  scene.add(visible);
  const hidden = new THREE.Group();
  hidden.visible = false;
  hidden.add(new THREE.Mesh(geometry, material));
  scene.add(hidden);
  const hud = new THREE.Group();
  hud.userData.raytracingExclude = true;
  hud.add(new THREE.Mesh(geometry, material));
  scene.add(hud);
  const hiddenMesh = new THREE.Mesh(geometry, material);
  hiddenMesh.visible = false;
  scene.add(hiddenMesh);
  const excludedMesh = new THREE.Mesh(geometry, material);
  excludedMesh.userData.raytracingExclude = true;
  scene.add(excludedMesh);
  scene.add(new THREE.InstancedMesh(geometry, material, 0));

  const snapshot = await createPathTracingSnapshot(scene);
  try {
    assert.equal(meshesIn(snapshot.scene).length, 1);
    near(meshesIn(snapshot.scene)[0].geometry.getAttribute('position').getX(0), 7, 'Visible building position');
    assert.equal(scene.children.length, 6, 'The live scene graph remains intact');
    assert.equal(hidden.visible, false);
    assert.equal(hud.children.length, 1);
  } finally {
    snapshot.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('custom water shader becomes a physical transmissive surface with an owned ripple texture', async () => {
  const scene = new THREE.Scene();
  const geometry = new THREE.PlaneGeometry(4, 4);
  const shader = new THREE.ShaderMaterial({ uniforms: { time: { value: 12.5 } } });
  scene.add(new THREE.Mesh(geometry, shader));
  let shaderDisposals = 0;
  shader.addEventListener('dispose', () => shaderDisposals++);
  const snapshot = await createPathTracingSnapshot(scene);
  const physical = meshesIn(snapshot.scene)[0].material as THREE.MeshPhysicalMaterial;
  assert.ok(physical instanceof THREE.MeshPhysicalMaterial);
  assert.ok(physical.transmission > 0);
  assert.ok(physical.roughness < 0.3);
  near(physical.ior, 1.333, 'Water refraction index');
  assert.ok(physical.normalMap instanceof THREE.DataTexture);
  let rippleDisposals = 0;
  physical.normalMap.addEventListener('dispose', () => rippleDisposals++);
  snapshot.dispose();
  assert.equal(rippleDisposals, 1);
  assert.equal(shaderDisposals, 0);
  assert.equal(shader.uniforms.time.value, 12.5);
  geometry.dispose();
  shader.dispose();
});

test('snapshot owns cloned geometry and deduplicated materials while preserving live resources on disposal', async () => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xaec7ce);
  const sourceBackground = scene.background.clone();
  const geometry = triangle();
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x8ebcb4, map: texture });
  scene.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  let originalGeometryDisposals = 0;
  let originalMaterialDisposals = 0;
  let originalTextureDisposals = 0;
  geometry.addEventListener('dispose', () => originalGeometryDisposals++);
  material.addEventListener('dispose', () => originalMaterialDisposals++);
  texture.addEventListener('dispose', () => originalTextureDisposals++);
  const sourceColor = material.color.clone();
  const snapshot = await createPathTracingSnapshot(scene);
  const [first, second] = meshesIn(snapshot.scene);
  assert.notEqual(first.geometry, geometry);
  assert.notEqual(first.geometry.getAttribute('position').array, geometry.getAttribute('position').array);
  assert.notEqual(first.geometry, second.geometry);
  assert.notEqual(first.material, material);
  assert.equal(first.material, second.material, 'A shared source material should have one snapshot owner');
  first.geometry.getAttribute('position').setX(0, 123);
  (first.material as THREE.MeshStandardMaterial).color.set(0xff0000);
  (snapshot.scene.background as THREE.Color).set(0x000000);
  assert.equal(geometry.getAttribute('position').getX(0), 0);
  assert.ok(material.color.equals(sourceColor));
  assert.ok(scene.background.equals(sourceBackground));

  let clonedGeometryDisposals = 0;
  let clonedMaterialDisposals = 0;
  let skyDisposals = 0;
  first.geometry.addEventListener('dispose', () => clonedGeometryDisposals++);
  second.geometry.addEventListener('dispose', () => clonedGeometryDisposals++);
  (first.material as THREE.Material).addEventListener('dispose', () => clonedMaterialDisposals++);
  snapshot.scene.environment!.addEventListener('dispose', () => skyDisposals++);
  snapshot.dispose();
  assert.equal(clonedGeometryDisposals, 2);
  assert.equal(clonedMaterialDisposals, 1);
  assert.equal(skyDisposals, 1);
  assert.equal(snapshot.scene.children.length, 0);
  assert.equal(scene.children.length, 2);
  assert.equal(originalGeometryDisposals, 0);
  assert.equal(originalMaterialDisposals, 0);
  assert.equal(originalTextureDisposals, 0);
  geometry.dispose();
  material.dispose();
  texture.dispose();
});

test('instanced material groups retain assignments and cover every expanded indexed triangle', async () => {
  const scene = new THREE.Scene();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  geometry.addGroup(0, 3, 1);
  geometry.addGroup(3, 3, 0);
  const materials = [new THREE.MeshStandardMaterial({ color: 0xff0000 }), new THREE.MeshStandardMaterial({ color: 0x0000ff })];
  const instances = new THREE.InstancedMesh(geometry, materials, 2);
  instances.setMatrixAt(0, new THREE.Matrix4());
  instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(5, 0, 0));
  scene.add(instances);
  const snapshot = await createPathTracingSnapshot(scene);
  try {
    const [mesh] = meshesIn(snapshot.scene);
    assert.ok(Array.isArray(mesh.material));
    assert.equal(mesh.material.length, 2);
    assert.notEqual(mesh.material[0], materials[0]);
    assert.notEqual(mesh.material[1], materials[1]);
    assert.deepEqual(mesh.geometry.groups, [
      { start: 0, count: 3, materialIndex: 1 },
      { start: 3, count: 3, materialIndex: 0 },
      { start: 6, count: 3, materialIndex: 1 },
      { start: 9, count: 3, materialIndex: 0 },
    ]);
    assert.equal(mesh.geometry.groups.reduce((count, group) => count + group.count, 0), mesh.geometry.index!.count);
    assert.equal(geometry.index!.count, 6);
    assert.equal(geometry.groups.length, 2);
  } finally {
    snapshot.dispose();
    geometry.dispose();
    materials.forEach(material => material.dispose());
  }
});

test('mixed RGB terrain and uncolored surfaces keep RGBA colors through the real pathtracer geometry merge', async () => {
  const scene = new THREE.Scene();
  const grassGeometry = triangle();
  grassGeometry.setAttribute('color', new THREE.Float32BufferAttribute([1, 0.5, 0.25, 1, 0.5, 0.25, 1, 0.5, 0.25], 3));
  const grassMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const grass = new THREE.InstancedMesh(grassGeometry, grassMaterial, 1);
  grass.setMatrixAt(0, new THREE.Matrix4());
  grass.setColorAt(0, new THREE.Color(0.4, 0.6, 0.2));
  const plainGeometry = new THREE.PlaneGeometry(4, 4);
  const plainMaterial = new THREE.MeshStandardMaterial({ color: 0xacc6b8 });
  scene.add(grass, new THREE.Mesh(plainGeometry, plainMaterial));

  const snapshot = await createPathTracingSnapshot(scene);
  let generatedGeometry: THREE.BufferGeometry | undefined;
  try {
    const meshes = meshesIn(snapshot.scene);
    assert.equal(meshes.length, 2);
    const expectedColors = [[0.4, 0.3, 0.05, 1], [1, 1, 1, 1]];
    for (let meshIndex = 0; meshIndex < meshes.length; meshIndex++) {
      const colors = meshes[meshIndex].geometry.getAttribute('color');
      assert.ok(colors, 'Every snapshot mesh needs a consistent color attribute before upstream merging');
      assert.equal(colors.itemSize, 4);
      for (let vertex = 0; vertex < colors.count; vertex++) {
        for (let component = 0; component < 4; component++) {
          near(colors.getComponent(vertex, component), expectedColors[meshIndex][component], 'Snapshot RGBA');
        }
      }
    }

    // This uses the actual dependency path that previously zeroed RGB terrain
    // when merging it with implicitly RGBA, uncolored geometry.
    const generated = new PathTracingSceneGenerator(snapshot.scene).generate();
    generatedGeometry = generated.geometry;
    const mergedColors = generated.geometry.getAttribute('color');
    const materialIndices = generated.geometry.getAttribute('materialIndex');
    assert.equal(mergedColors.itemSize, 4);
    for (let meshIndex = 0; meshIndex < meshes.length; meshIndex++) {
      const materialIndex = generated.materials.indexOf(meshes[meshIndex].material as THREE.Material);
      assert.ok(materialIndex >= 0);
      let checkedVertices = 0;
      for (let vertex = 0; vertex < mergedColors.count; vertex++) {
        if (materialIndices.getX(vertex) !== materialIndex) continue;
        checkedVertices++;
        for (let component = 0; component < 4; component++) {
          near(mergedColors.getComponent(vertex, component), expectedColors[meshIndex][component], 'Merged RGBA');
        }
      }
      assert.equal(checkedVertices, meshes[meshIndex].geometry.getAttribute('position').count);
    }
    assert.equal(grassGeometry.getAttribute('color').itemSize, 3, 'The live RGB buffer is unchanged');
    assert.equal(plainGeometry.getAttribute('color'), undefined, 'The live uncolored surface is unchanged');
  } finally {
    generatedGeometry?.dispose();
    snapshot.dispose();
    grassGeometry.dispose();
    plainGeometry.dispose();
    grassMaterial.dispose();
    plainMaterial.dispose();
  }
});

test('every graphics profile supplies changing random samples for all BSDF dimensions and shadow traversals', async () => {
  // The deprecated material remains a real runtime export in 0.0.24, but its
  // declaration was removed. Instantiate it without a renderer to exercise the
  // exact sampler and assembled GLSL used by WebGLPathTracer.
  const library = await import('three-gpu-pathtracer');
  type Sampler = THREE.DataTexture & { init(count: number, depth: number): void; next(): void };
  const Material = Reflect.get(library, 'PhysicalPathTracingMaterial') as new () => THREE.ShaderMaterial & { stratifiedTexture: Sampler };
  const material = new Material();
  try {
    const randomDimensions = [...new Set([...material.fragmentShader.matchAll(/\brand[234]?\(\s*(\d+)\s*\)/g)].map(match => Number(match[1])))];
    assert.ok(randomDimensions.length > 0, 'Read actual random-coordinate use from the dependency shader');
    assert.ok(Math.max(...randomDimensions) >= 16, 'Include the volume and BSDF sampling dimensions');

    for (const quality of ['performance', 'balanced', 'ultra'] as const) {
      const { bounces, transmissiveBounces } = getPathTracingSettings(quality);
      const texture = material.stratifiedTexture;
      texture.init(20, bounces + transmissiveBounces + 5);
      const { width, height } = texture.image;
      for (const dimension of randomDimensions) {
        assert.ok(dimension < width, `${quality}: random dimension ${dimension} must fit texture width ${width}`);
      }

      // Main depth is k + consumedTransmission + 1. A shadow ray can traverse
      // (bounces - k) + remainingTransmission further surfaces before resetting
      // the shared bounce index: the conservative maximum row is B + T + 1.
      const lastShadowRow = bounces + transmissiveBounces + 1;
      assert.ok(lastShadowRow < height, `${quality}: shadow row ${lastShadowRow} must fit texture height ${height}`);
      const readAddressedSamples = () => {
        const data = texture.image.data as Float32Array;
        const samples: number[] = [];
        for (let row = 0; row <= lastShadowRow; row++) {
          for (const dimension of randomDimensions) {
            for (let component = 0; component < 4; component++) {
              const value = data[(row * width + dimension) * 4 + component];
              assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `${quality}: valid sample at (${dimension}, ${row}, ${component})`);
              samples.push(value);
            }
          }
        }
        return samples;
      };
      const before = readAddressedSamples();
      const version = texture.version;
      texture.next();
      assert.ok(texture.version > version, `${quality}: new samples must request a GPU upload`);
      assert.notDeepEqual(readAddressedSamples(), before, `${quality}: advancing samples must not repeat a static noise pattern`);
    }
  } finally {
    material.stratifiedTexture.dispose();
    material.dispose();
  }
});
