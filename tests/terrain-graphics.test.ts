import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCity } from '../src/simulation.ts';
import {
  buildTerrainChunk, buildTerrainSkirt, sampleGroundHeight, terrainChunkSignature,
  type TerrainMaterials,
} from '../src/terrain-graphics.ts';
import type { CityState } from '../src/types.ts';

function materials(): TerrainMaterials {
  // Geometry tests deliberately avoid CanvasTexture and therefore need no browser or GPU.
  return { ground: new THREE.MeshStandardMaterial(), earth: new THREE.MeshStandardMaterial(), rock: new THREE.MeshStandardMaterial() };
}

function hillyCity(): CityState {
  const city = createCity(7351, true, 40);
  for (const tile of city.tiles) {
    tile.kind = 'empty';
    tile.elevation = Math.round((3+Math.sin(tile.x*.47)*1.5+Math.cos(tile.z*.31))*2)/2;
  }
  return city;
}

function seededRandom(seed = 59): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525)+1013904223)>>>0;
    return seed/4294967296;
  };
}

function surfaceHeight(group: THREE.Object3D, x: number, z: number): number {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObject(group, true)[0];
  assert.ok(hit, `Terrain must have an upward-facing triangle at ${x}, ${z}`);
  return hit.point.y;
}

function dispose(group: THREE.Object3D, mats: TerrainMaterials): void {
  group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  Object.values(mats).forEach(material => material.dispose());
}

test('indexed terrain has no holes and exact height sampling matches 100 raycasts through irregular elevations', t => {
  const city = hillyCity(), mats = materials(), group = new THREE.Group(), random = seededRandom();
  // Include negative seabed and building transitions, in addition to hills.
  for (const tile of city.tiles) {
    tile.elevation = Math.round((random()*7-2)*2)/2;
    tile.kind = tile.elevation<0 ? 'water' : random()<.25 ? 'residential' : 'empty';
  }
  for (let z=0; z<16; z+=8) for (let x=0; x<16; x+=8) {
    const chunk = buildTerrainChunk(city, x, z, 8, mats);
    const geometry = (chunk.children[0] as THREE.Mesh).geometry;
    assert.ok(geometry.index, 'Terrain must use an indexed mesh');
    assert.ok(geometry.getAttribute('position').count<geometry.index.count, 'Vertices must be reused across terrain triangles');
    group.add(chunk);
  }
  t.after(() => dispose(group, mats));
  group.updateMatrixWorld(true);
  for (let i=0; i<100; i++) {
    const x = .001+random()*15.998-city.size/2, z = .001+random()*15.998-city.size/2;
    const actual = surfaceHeight(group, x, z), sampled = sampleGroundHeight(city, x, z);
    assert.ok(Math.abs(actual-sampled)<.00001, `Sampler differs from rendered surface: ${actual} versus ${sampled}`);
  }
});

test('adjacent terrain chunks share identical edge heights and normals in both directions', t => {
  const city = hillyCity(), mats = materials(), group = new THREE.Group();
  // Foundations on a chunk edge exercise the smoothing halo as well as empty ground.
  city.tiles[3*city.size+7].kind = 'hospital';
  const center = buildTerrainChunk(city, 0, 0, 8, mats);
  const right = buildTerrainChunk(city, 8, 0, 8, mats);
  const below = buildTerrainChunk(city, 0, 8, 8, mats);
  group.add(center, right, below);
  t.after(() => dispose(group, mats));
  function boundary(chunk: THREE.Group, axis: 'x'|'z'): Map<number, number[]> {
    const geometry = (chunk.children[0] as THREE.Mesh).geometry;
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    const out = new Map<number, number[]>(), boundaryPosition = 8-city.size/2;
    for (let i=0; i<positions.count; i++) {
      const coordinate = axis==='x' ? positions.getX(i) : positions.getZ(i);
      if (coordinate!==boundaryPosition) continue;
      const along = axis==='x' ? positions.getZ(i) : positions.getX(i);
      out.set(along, [positions.getY(i), normals.getX(i), normals.getY(i), normals.getZ(i)]);
    }
    return out;
  }
  for (const [neighbor, axis] of [[right, 'x'], [below, 'z']] as const) {
    const first = boundary(center, axis), second = boundary(neighbor, axis);
    assert.equal(first.size, 9, 'An eight-cell edge must contain nine shared corners');
    assert.equal(second.size, first.size);
    for (const [coordinate, values] of first) assert.deepEqual(second.get(coordinate), values);
  }
});

test('terrain signatures invalidate on elevation and occupancy halo changes but ignore unrelated city changes', () => {
  const city = hillyCity();
  const signature = () => terrainChunkSignature(city, 0, 0, 8);
  const initial = signature();
  city.money += 100; city.month++; city.speed = 3;
  city.tiles[0].powered = !city.tiles[0].powered;
  assert.equal(signature(), initial, 'Economic and utility changes must not rebuild terrain');
  city.tiles[10*city.size+10].elevation += .5;
  assert.equal(signature(), initial, 'A tile outside the normal halo must not rebuild this chunk');
  city.tiles[9*city.size+9].elevation += .5;
  assert.notEqual(signature(), initial, 'The outer normal halo must invalidate the chunk');
  const afterHeight = signature();
  city.tiles[2*city.size+2].kind = 'road';
  assert.notEqual(signature(), afterHeight, 'Adding a level foundation must invalidate terrain');
});

test('occupied tiles have a planar foundation at their exact persisted elevation', t => {
  const city = hillyCity(), mats = materials();
  const tile = city.tiles[10*city.size+10];
  tile.kind = 'police'; tile.elevation = 4.5;
  const chunk = buildTerrainChunk(city, 8, 8, 8, mats);
  t.after(() => dispose(chunk, mats));
  chunk.updateMatrixWorld(true);
  for (const u of [.05, .5, .95]) for (const v of [.05, .5, .95]) {
    const x = tile.x+u-city.size/2, z = tile.z+v-city.size/2;
    assert.equal(sampleGroundHeight(city, x, z), tile.elevation);
    assert.ok(Math.abs(surfaceHeight(chunk, x, z)-tile.elevation)<.000001);
  }
  // The bevel still joins the surrounding hills with the same sampler/mesh geometry.
  const x = tile.x+.01-city.size/2, z = tile.z+.5-city.size/2;
  assert.ok(Math.abs(surfaceHeight(chunk, x, z)-sampleGroundHeight(city, x, z))<.00001);
});

test('terrain skirt closes all four perimeter edges using vertical triangles only', t => {
  const city = hillyCity(), mats = materials(), skirt = buildTerrainSkirt(city, mats.earth);
  t.after(() => dispose(skirt, mats));
  skirt.updateMatrixWorld(true);
  const geometry = (skirt.children[0] as THREE.Mesh).geometry;
  const positions = geometry.getAttribute('position'), indices = geometry.index!;
  const half = city.size/2;
  assert.equal(indices.count/3, city.size*4*2);
  for (let i=0; i<indices.count; i+=3) {
    const corners = [0, 1, 2].map(n => new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i+n)));
    const sameX = corners.every(p => p.x===corners[0].x && Math.abs(p.x)===half);
    const sameZ = corners.every(p => p.z===corners[0].z && Math.abs(p.z)===half);
    assert.ok(sameX||sameZ, 'Every skirt face must be vertical and lie on the map perimeter');
    assert.ok(corners.some(p => p.y!==corners[0].y), 'The skirt must not contain overlapping horizontal surfaces');
  }
  const ray = new THREE.Raycaster();
  for (let i=0; i<city.size; i++) for (let side=0; side<4; side++) {
    const along = i+.5-half;
    const x = side===0 ? -half : side===1 ? half : along;
    const z = side===2 ? -half : side===3 ? half : along;
    const y = sampleGroundHeight(city, x, z)-.25;
    const direction = new THREE.Vector3(side===0?1:side===1?-1:0, 0, side===2?1:side===3?-1:0);
    ray.set(new THREE.Vector3(x, y, z).addScaledVector(direction, -1), direction);
    const hit = ray.intersectObject(skirt, true)[0];
    assert.ok(hit, `Open terrain perimeter at side ${side}, cell ${i}`);
    assert.ok(Math.abs(hit.distance-1)<.00001, 'The near perimeter face must face outward');
  }
});
