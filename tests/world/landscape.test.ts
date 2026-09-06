import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { Tile } from '../../src/domain/types.ts';
import { getTerrainElevation, isForestTerrain } from '../../src/world/terrain.ts';
import {
  buildLandscapeChunk,
  landscapeChunkSignature,
} from '../../src/rendering/world/landscape.ts';
import { createCity } from '../../src/simulation/city-simulation.ts';

test('every world size has seeded mountains, water, connected woodland and a flat central starter', () => {
  for (const size of [40, 64, 96, 128])
    for (const seed of [1, 42, 2026, 4294967295]) {
      const elevations: number[] = [],
        forest = new Set<number>();
      let varied = 0;
      for (let z = 0; z < size; z++)
        for (let x = 0; x < size; x++) {
          const h = getTerrainElevation(x, z, size, seed);
          elevations.push(h);
          assert.equal(h, getTerrainElevation(x, z, size, seed));
          assert.equal(h * 2, Math.round(h * 2));
          assert.ok(h >= -2 && h <= 12);
          if (h !== getTerrainElevation(x, z, size, seed + 1)) varied++;
          if (isForestTerrain(x, z, size, seed)) forest.add(z * size + x);
        }
      assert.ok(Math.max(...elevations) >= 7);
      assert.ok(Math.min(...elevations) < 0);
      assert.ok(varied > size * size * 0.1);
      assert.ok(forest.size > size * size * 0.12, 'Enough woodland to read as a forest');
      const adjoining = [...forest].filter(
        (i) =>
          forest.has(i - 1) || forest.has(i + 1) || forest.has(i - size) || forest.has(i + size),
      );
      assert.ok(adjoining.length > forest.size * 0.85, 'Trees must form coherent stands');
      for (let z = Math.floor(size * 0.36); z < Math.floor(size * 0.56); z++)
        for (let x = Math.floor(size * 0.35); x < Math.floor(size * 0.55); x++) {
          assert.equal(getTerrainElevation(x, z, size, seed), 0);
          assert.equal(isForestTerrain(x, z, size, seed), false);
        }
    }
});

test('forest chunks batch dense canopy and invalidate for adjacent height or occupation edits', () => {
  const city = createCity(73, true, 40);
  for (const tile of city.tiles) {
    tile.kind = 'tree';
    tile.elevation = 4;
  }
  const group = buildLandscapeChunk(city, 8, 8, 8),
    again = buildLandscapeChunk(city, 8, 8, 8);
  try {
    assert.ok(group.children.length <= 4);
    assert.equal(group.userData.treeCount, 8 * 8 * 3);
    for (let i = 0; i < group.children.length; i++) {
      const mesh = group.children[i] as THREE.InstancedMesh,
        other = again.children[i] as THREE.InstancedMesh;
      assert.ok(mesh.isInstancedMesh);
      assert.deepEqual(mesh.instanceMatrix.array, other.instanceMatrix.array);
      assert.ok(Array.from(mesh.instanceMatrix.array).every(Number.isFinite));
    }
    const before = landscapeChunkSignature(city, 8, 8, 8);
    city.tiles[8 * 40 + 7].elevation += 0.5;
    assert.notEqual(before, landscapeChunkSignature(city, 8, 8, 8));
    const changed = landscapeChunkSignature(city, 8, 8, 8);
    city.tiles[9 * 40 + 9].kind = 'road';
    assert.notEqual(changed, landscapeChunkSignature(city, 8, 8, 8));
  } finally {
    for (const g of [group, again])
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
        }
      });
  }
});

test('128-field founding worlds provide a contiguous 56 by 56 clear plain with mountains and forests beyond', () => {
  for (const seed of [0, 1, 42, 2026, 6092026, 4294967295]) {
    const city = createCity(seed, true);
    assert.equal(city.size, 128);
    // A complete rectangle, not a count of disconnected little glades: facilities and
    // several full street blocks fit without terraforming or clearing trees first.
    for (let z = 31; z < 87; z++)
      for (let x = 30; x < 86; x++) {
        const tile: Tile = city.tiles[z * city.size + x];
        assert.equal(tile.elevation, 0, `Flat founding plot ${x},${z}, seed ${seed}`);
        assert.equal(tile.kind, 'empty', `Clear founding plot ${x},${z}, seed ${seed}`);
      }
    const mountains = city.tiles.filter((tile) => tile.elevation >= 7);
    assert.ok(
      mountains.length >= 100,
      'Large contiguous building space must retain visible massifs',
    );
    assert.ok(
      mountains.every((tile) => tile.z < 31 || tile.z >= 87 || tile.x < 30 || tile.x >= 86),
    );
    assert.ok(
      city.tiles.filter((tile) => tile.kind === 'tree').length > 2000,
      'Woodland remains around the founding valley',
    );
    assert.ok(city.tiles.some((tile) => tile.kind === 'water'));
  }
});
