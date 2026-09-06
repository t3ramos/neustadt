import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { box } from '../../src/rendering/buildings/primitives';
import { palette, setModelNightBlend } from '../../src/rendering/buildings/materials';
import { addBuildingWindowLights } from '../../src/rendering/buildings/window-lights';
import { stadium, windPlant } from '../../src/rendering/buildings/facilities';
import type { Tile } from '../../src/domain/types';

test('discrete windows retain the original deterministic strongest sixteen panes', () => {
  for (const variation of [0, 1, 17, -36, 995]) {
    const group = new THREE.Group();
    // Twenty separated short strips offer exactly two panes each, providing
    // an independent fixture with known coordinates and deterministic scores.
    for (let i = 0; i < 20; i++) box(group, palette.glass, i, 1, 0, 0.1, 0.1, 0.01);
    const expected = Array.from({ length: 40 }, (_, index) => {
      const value =
        Math.sin((Math.abs(variation) + 1) * 12.9898 + (index + 1) * 78.233) * 43758.5453;
      return {
        score: value - Math.floor(value),
        x: Math.floor(index / 2),
        z: index % 2 ? -0.006 : 0.006,
      };
    })
      .filter((pane) => pane.score <= 0.35)
      .sort((a, b) => a.score - b.score)
      .slice(0, 16);
    addBuildingWindowLights(group, { variation } as Tile);
    const panes = group.children.filter(
      (child) => child.name === 'building-window-light',
    ) as THREE.Mesh[];
    assert.equal(panes.length, expected.length);
    panes.forEach((pane, index) => {
      assert.equal(pane.position.x, expected[index].x);
      assert.ok(Math.abs(pane.position.z - expected[index].z) < 1e-10);
      assert.deepEqual(pane.scale.toArray(), [0.05500000000000001, 0.072, 0.002]);
      assert.equal(pane.castShadow, false);
    });
    setModelNightBlend(1);
    assert.ok(
      panes.every(
        (pane) => (pane.material as THREE.MeshStandardMaterial).emissiveIntensity === 0.2,
      ),
    );
    setModelNightBlend(0);
  }
});

test('repeated turbine and stadium models share their immutable custom geometry', () => {
  for (const build of [stadium, windPlant]) {
    const first = new THREE.Group(),
      second = new THREE.Group();
    build(first);
    build(second);
    const geometries = (root: THREE.Group): THREE.BufferGeometry[] => {
      const result: THREE.BufferGeometry[] = [];
      root.traverse((child) => {
        if (child instanceof THREE.Mesh) result.push(child.geometry);
      });
      return result;
    };
    const a = geometries(first),
      b = geometries(second);
    assert.equal(a.length, b.length);
    assert.ok(
      a.every((geometry, index) => geometry === b[index]),
      'model construction must not allocate identical geometry per tile',
    );
  }
});
