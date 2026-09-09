import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCity } from '../../src/simulation/city-simulation';
import { createCitizenEventVenue, disposeCitizenEventVenue } from '../../src/citizens/event-venue';
import { createPedestrianGraph } from '../../src/citizens/routing';
import { sampleGroundHeight } from '../../src/rendering/world/terrain';
import { boxGeometry } from '../../src/rendering/buildings/primitives';

function fixture() {
  const state = createCity(81, true, 40);
  for (const tile of state.tiles)
    Object.assign(tile, { kind: 'empty', level: 0, anchor: -1, elevation: 0, fire: 0 });
  Object.assign(state.tiles[12 * 40 + 12], { kind: 'park', level: 1, variation: 3 });
  Object.assign(state.tiles[13 * 40 + 12], { kind: 'road', level: 1 });
  Object.assign(state.tiles[11 * 40 + 12], { kind: 'water', elevation: -1 });
  Object.assign(state.tiles[12 * 40 + 13], { kind: 'residential', level: 3 });
  return state;
}

test('both venues create distinct adult-scale furniture within a two by two site without modifying the city', () => {
  const state = fixture(),
    before = JSON.stringify(state);
  const signatures = [];
  for (const kind of ['gathering', 'festival'] as const) {
    const group = createCitizenEventVenue(state, { kind, x: -7.5, z: -7.5 });
    const info = group.userData.eventVenue;
    assert.equal(info.placed, true);
    assert.deepEqual(info.endpoint, { x: -7.5, z: -7.5 });
    assert.ok(
      info.placements.some(
        (p: { name: string }) => p.name === (kind === 'festival' ? 'stage' : 'lemonade-stand'),
      ),
    );
    const bounds = new THREE.Box3().setFromObject(group),
      size = bounds.getSize(new THREE.Vector3());
    assert.ok(size.x <= 2 && size.z <= 2);
    assert.ok(size.y > 0.23 && size.y < 0.42, 'canopies accommodate .17-high residents');
    let triangles = 0;
    group.traverse((part) => {
      if (part instanceof THREE.Mesh)
        triangles +=
          (part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3;
      assert.ok(!(part instanceof THREE.Light));
    });
    assert.ok(group.children.length <= 7 && triangles < 3000);
    signatures.push(
      `${triangles}:${info.placements.map((p: { name: string }) => p.name).join(',')}`,
    );
    for (const p of info.placements) {
      assert.ok(['empty', 'park'].includes(state.tiles[p.tile].kind));
      const tile = state.tiles[p.tile],
        cx = tile.x - 19.5,
        cz = tile.z - 19.5;
      assert.ok(
        Math.abs(p.x - cx) + p.width / 2 <= 0.461 && Math.abs(p.z - cz) + p.depth / 2 <= 0.461,
      );
    }
    disposeCitizenEventVenue(group);
  }
  assert.notEqual(signatures[0], signatures[1]);
  assert.equal(JSON.stringify(state), before);
});

test('venue furniture preserves existing park routing nodes and every route segment', () => {
  const state = fixture();
  const graph = createPedestrianGraph(state, [12 * 40 + 12, 13 * 40 + 12]);
  for (const kind of ['gathering', 'festival'] as const) {
    const group = createCitizenEventVenue(state, { kind, x: -7.5, z: -7.5 });
    for (const node of graph.nodes)
      for (const edge of graph.neighbors(node.id)) {
        const other = graph.byId.get(edge.node)!;
        for (let i = 0; i <= 20; i++) {
          const x = node.x + ((other.x - node.x) * i) / 20,
            z = node.z + ((other.z - node.z) * i) / 20;
          for (const p of group.userData.eventVenue.placements)
            assert.ok(
              Math.abs(x - p.x) > p.width / 2 + 0.025 || Math.abs(z - p.z) > p.depth / 2 + 0.025,
              'route passes through furniture',
            );
        }
      }
    disposeCitizenEventVenue(group);
  }
});

test('individual feet follow terrain support and no resources from city models are disposed', () => {
  const state = fixture();
  for (const tile of state.tiles) if (tile.kind === 'empty') tile.elevation = (tile.x - 12) * 0.015;
  const group = createCitizenEventVenue(state, { kind: 'festival', x: -7.5, z: -7.5 });
  // Use a positive slope to retain available grass above water level.
  if (!group.userData.eventVenue.placed) {
    disposeCitizenEventVenue(group);
    for (const tile of state.tiles) if (tile.kind === 'empty') tile.elevation = 0.01;
  }
  const venue = group.userData.eventVenue.placed
    ? group
    : createCitizenEventVenue(state, { kind: 'festival', x: -7.5, z: -7.5 });
  assert.equal(venue.userData.eventVenue.placed, true);
  for (const foot of venue.userData.eventVenue.feet) {
    const tile = state.tiles[Math.floor(foot.z + 20) * 40 + Math.floor(foot.x + 20)];
    const y = Math.max(
      sampleGroundHeight(state, foot.x, foot.z),
      tile.kind === 'park' ? Math.max(0, tile.elevation) + 0.028 : -Infinity,
    );
    assert.ok(Math.abs(foot.y - y) < 1e-9);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(foot.x, foot.y - 0.1, foot.z),
      new THREE.Vector3(0, 1, 0),
    );
    const hit = ray.intersectObject(venue, true)[0];
    assert.ok(hit, 'each reported foot has physical furniture geometry');
    assert.ok(Math.abs(hit.point.y - foot.y) < 1e-5);
  }
  let disposed = 0,
    sharedDisposed = false;
  const listener = () => {
    sharedDisposed = true;
  };
  boxGeometry.addEventListener('dispose', listener);
  const resources = new Set<THREE.BufferGeometry | THREE.Material>();
  venue.traverse((p) => {
    if (p instanceof THREE.Mesh) {
      resources.add(p.geometry);
      resources.add(p.material as THREE.Material);
    }
  });
  for (const r of resources)
    r.addEventListener('dispose', () => {
      disposed++;
    });
  disposeCitizenEventVenue(venue);
  disposeCitizenEventVenue(venue);
  assert.equal(disposed, resources.size);
  assert.equal(sharedDisposed, false);
  assert.equal(venue.children.length, 0);
  boxGeometry.removeEventListener('dispose', listener);
});

test('crowded parks never receive a forced venue on trees, streets, water or buildings', () => {
  const state = fixture();
  for (const tile of state.tiles)
    if (tile.kind === 'empty') Object.assign(tile, { kind: 'residential', level: 2 });
  state.tiles[12 * 40 + 12].variation = 4;
  const group = createCitizenEventVenue(state, { kind: 'festival', x: -7.5, z: -7.5 });
  assert.equal(group.userData.eventVenue.placed, false);
  assert.equal(group.userData.eventVenue.reason, 'no-safe-space');
  assert.equal(group.children.length, 0);
  disposeCitizenEventVenue(group);
});
