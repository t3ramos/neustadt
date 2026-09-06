import assert from 'node:assert/strict';
import test from 'node:test';
import { createCity } from '../../src/simulation/city-simulation.ts';
import { routeForWaterBody, sampleWaterRoute } from '../../src/rendering/world/water-routes.ts';

test('sailboat routes move over 1500 samples and remain inside their original disconnected water body', () => {
  const state = createCity(42, true),
    n = state.size;
  for (const t of state.tiles) {
    t.kind = 'empty';
    t.elevation = 0;
  }
  for (const ox of [4, 25])
    for (let z = 4; z < 16; z++)
      for (let x = ox; x < ox + 12; x++) {
        const t = state.tiles[z * n + x];
        t.kind = 'water';
        t.elevation = -1;
      }
  // A bridge is not traversable water even though its terrain remains submerged.
  state.tiles[9 * n + 9].kind = 'road';
  for (const start of [6, 27]) {
    const route = routeForWaterBody(state, start, 6, 64);
    assert.ok(route.length > 5);
    assert.deepEqual(route[0], route.at(-1));
    let farthest = 0;
    for (let f = 0; f < 1500; f++) {
      const p = sampleWaterRoute(route, f * 0.071),
        x = Math.floor(p.x + n / 2),
        z = Math.floor(p.z + n / 2);
      assert.equal(state.tiles[z * n + x].kind, 'water');
      assert.ok(start === 6 ? x < 16 : x >= 25);
      farthest = Math.max(farthest, Math.hypot(p.x - route[0].x, p.z - route[0].z));
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++)
          assert.equal(state.tiles[(z + dz) * n + x + dx].kind, 'water');
    }
    assert.ok(farthest > 4, 'boat must cruise beyond its initial rocking position');
    assert.deepEqual(sampleWaterRoute(route, 0), sampleWaterRoute(route, route.length - 1));
  }
  assert.deepEqual(routeForWaterBody(state, 9, 9), []);
  assert.deepEqual(routeForWaterBody(state, 4, 4), []);
});
