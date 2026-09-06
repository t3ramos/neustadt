import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createCity,
  build,
  serializeCity,
  deserializeCity,
} from '../../src/simulation/city-simulation.ts';
import { recreationRoute, createWaterRecreation } from '../../src/rendering/world/recreation.ts';
import { buildBeach } from '../../src/rendering/buildings/beach.ts';
function flat() {
  const s = createCity(45, true);
  for (const t of s.tiles) {
    t.kind = 'empty';
    t.elevation = 0;
    t.anchor = -1;
    t.lotWidth = undefined;
    t.lotDepth = undefined;
  }
  s.money = 100000;
  return s;
}
test('recreation rejects tiny ponds and uses cardinal closed water-only paths', () => {
  const s = flat(),
    at = (x: number, z: number) => s.tiles[z * s.size + x];
  for (let z = 3; z < 6; z++)
    for (let x = 3; x < 6; x++) {
      at(x, z).kind = 'water';
      at(x, z).elevation = -1;
    }
  assert.equal(recreationRoute(s).length, 0);
  for (let z = 3; z < 12; z++)
    for (let x = 3; x < 10; x++) {
      at(x, z).kind = 'water';
      at(x, z).elevation = -1;
    }
  at(6, 6).kind = 'tree';
  at(6, 6).elevation = 0;
  const route = recreationRoute(s);
  assert.ok(route.length > 20);
  assert.deepEqual(route[0], route.at(-1));
  for (let i = 0; i < route.length; i++) {
    const p = route[i];
    assert.equal(at(Math.floor(p.x + s.size / 2), Math.floor(p.z + s.size / 2)).kind, 'water');
    if (i) assert.equal(Math.abs(p.x - route[i - 1].x) + Math.abs(p.z - route[i - 1].z), 1);
  }
  const r = createWaterRecreation(s);
  for (let i = 0; i < 1500; i++) {
    r.animate(0.1, i * 0.1, 3);
    for (const p of r.getDebug().positions)
      assert.equal(at(Math.floor(p.x + s.size / 2), Math.floor(p.z + s.size / 2)).kind, 'water');
  }
  assert.equal(r.getDebug().actorCount, 4);
  for (const t of s.tiles) t.kind = 'empty';
  r.update(s);
  assert.equal(r.getDebug().actorCount, 0);
  r.dispose();
});
test('beach placement requires actual shore and survives save/load unanchored', () => {
  const s = flat(),
    tile = s.tiles[5 * s.size + 5];
  assert.equal(build(s, [{ x: 5, z: 5 }], 'beach').ok, false);
  const water = s.tiles[5 * s.size + 6];
  water.kind = 'water';
  water.elevation = -1;
  assert.equal(build(s, [{ x: 6, z: 5 }], 'beach').ok, false);
  assert.equal(build(s, [{ x: 5, z: 5 }], 'beach').ok, true);
  assert.equal(tile.anchor, -1);
  const saved = deserializeCity(serializeCity(s));
  assert.ok(saved);
  assert.equal(saved.tiles[5 * s.size + 5].kind, 'beach');
});
test('all five beach prop variants remain within a tile', () => {
  const tile = flat().tiles[0];
  for (let v = 0; v < 5; v++) {
    const g = buildBeach({ ...tile, kind: 'beach', variation: v });
    const bounds = new THREE.Box3().setFromObject(g);
    assert.ok(bounds.min.x >= -0.501 && bounds.max.x <= 0.501);
    assert.ok(bounds.min.z >= -0.501 && bounds.max.z <= 0.501);
    assert.equal(g.userData.beachVariant, v);
  }
});
