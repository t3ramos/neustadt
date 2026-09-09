import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { commercialHighrise, commercialMedium } from '../../src/rendering/buildings/architecture';
import { commercialRoundedGeometry } from '../../src/rendering/buildings/commercial-geometry';
import type { Tile } from '../../src/domain/types';
import { createCity } from '../../src/simulation/city-simulation';
import { createTileModel } from '../../src/rendering/buildings/models';
import { firePatchHeight, getFirePatches } from '../../src/rendering/effects/fire';

test('rounded commercial shells have outward winding, curved normals and upright arc-length facade UVs', () => {
  for (const radius of [0.22, 0.42]) {
    const geometry = commercialRoundedGeometry(radius);
    assert.equal(geometry, commercialRoundedGeometry(radius));
    const p = geometry.getAttribute('position'),
      n = geometry.getAttribute('normal'),
      uv = geometry.getAttribute('uv');
    assert.ok(p.count / 3 <= 160);
    assert.deepEqual(geometry.boundingBox!.min.toArray(), [-0.5, -0.5, -0.5]);
    assert.deepEqual(geometry.boundingBox!.max.toArray(), [0.5, 0.5, 0.5]);
    let curvedVertices = 0;
    const uRates: number[] = [];
    for (let i = 0; i < p.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, i),
        b = new THREE.Vector3().fromBufferAttribute(p, i + 1),
        c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
      const faceNormal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      assert.ok(
        faceNormal.dot(new THREE.Vector3().fromBufferAttribute(n, i)) > 0.98,
        'front-face winding agrees with shading normals',
      );
      for (let j = i; j < i + 3; j++) {
        assert.ok(uv.getX(j) >= 0 && uv.getX(j) <= 1);
        assert.ok(uv.getY(j) >= 0 && uv.getY(j) <= 1);
        if (n.getY(j) !== 0) continue;
        assert.equal(uv.getY(j), p.getY(j) + 0.5, 'windows stay upright on every curved face');
        if (Math.abs(n.getX(j)) > 0.1 && Math.abs(n.getZ(j)) > 0.1) curvedVertices++;
      }
      if (n.getY(i) === 0 && a.y !== b.y && a.x === b.x && a.z === b.z) {
        assert.equal(uv.getX(i), uv.getX(i + 1));
        uRates.push((uv.getX(i + 2) - uv.getX(i)) / Math.hypot(c.x - a.x, c.z - a.z));
      }
    }
    assert.ok(curvedVertices > 100, 'real curved walls, not cosmetic corner trim');
    assert.ok(
      Math.max(...uRates) - Math.min(...uRates) < 0.00001,
      'equal facade distance receives equal U, including curved segments',
    );
  }
});

test('curtain and campus use curved occupied bodies and matching caps at medium and highrise scales', () => {
  for (const [build, level, variations] of [
    [commercialHighrise, 3, [0, 4]],
    [commercialMedium, 2, [2, 4]],
  ] as const) {
    for (const variation of variations) {
      const group = new THREE.Group();
      build(group, { variation, level, lotWidth: 2, lotDepth: 3 } as Tile, true);
      const bodies: THREE.Mesh[] = [],
        caps: THREE.Mesh[] = [],
        cores: THREE.Mesh[] = [];
      group.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (child.name === 'commercial-structural-core') cores.push(child);
        if (!child.geometry.userData.commercialRounded) return;
        if ((child.material as THREE.MeshStandardMaterial).userData.facadeTexture)
          bodies.push(child);
        if (child.name === 'commercial-roof') caps.push(child);
      });
      assert.equal(bodies.length, 2);
      assert.equal(caps.length, 2);
      assert.equal(cores.length, 2);
      for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i],
          cap = caps[i];
        assert.equal(body.geometry, cap.geometry);
        assert.equal(body.position.x, cap.position.x);
        assert.equal(body.position.z, cap.position.z);
        assert.equal(cores[i].geometry.type, 'BoxGeometry');
        assert.deepEqual(cores[i].position, body.position);
        assert.equal(cores[i].scale.y, body.scale.y);
        assert.ok(cores[i].scale.x < body.scale.x && cores[i].scale.z < body.scale.z);
        assert.ok(
          Math.abs(body.position.y + body.scale.y / 2 - (cap.position.y - cap.scale.y / 2)) < 1e-7,
        );
        assert.ok(body.position.y - body.scale.y / 2 <= (variation === 0 ? 0.22 : 0.041));
      }
    }
  }
});

test('commercial families retain stepped brick, grounded terraces, podium and linked campus systems', () => {
  for (let variation = 0; variation < 5; variation++) {
    const group = new THREE.Group();
    commercialHighrise(group, { variation, level: 4, lotWidth: 2, lotDepth: 2 } as Tile, true);
    const bodies: THREE.Mesh[] = [];
    group.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        (child.material as THREE.MeshStandardMaterial).userData.facadeTexture
      )
        bodies.push(child);
    });
    if (variation === 1) {
      assert.equal(bodies.length, 3);
      assert.ok(bodies[0].scale.x > bodies[1].scale.x && bodies[1].scale.x > bodies[2].scale.x);
      assert.ok(group.getObjectByName('commercial-gabled-crown'));
    }
    if (variation === 2) {
      assert.equal(bodies.length, 3);
      assert.ok(bodies[0].scale.y < bodies[1].scale.y && bodies[1].scale.y < bodies[2].scale.y);
      for (const body of bodies)
        assert.ok(Math.abs(body.position.y - body.scale.y / 2 - 0.035) < 1e-6);
    }
    if (variation === 3) {
      assert.ok(bodies[0].scale.x > bodies[1].scale.x);
      assert.ok(
        bodies[0].position.y + bodies[0].scale.y / 2 >=
          bodies[1].position.y - bodies[1].scale.y / 2,
      );
      const crown = group.getObjectByName('commercial-gabled-crown') as THREE.Mesh;
      assert.ok(crown.scale.y > 0.5 && crown.scale.x === bodies[1].scale.x);
    }
    if (variation === 4) {
      assert.equal(bodies.length, 3);
      assert.ok(bodies[0].position.x < 0 && bodies[1].position.x > 0 && bodies[2].position.z < 0);
    }
  }
});

test('commercial fire samples follow visible curved caps and inclined crowns in every rotation', () => {
  const state = createCity(81, true, 40);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  for (let variation = 0; variation < 5; variation++)
    for (const [lotWidth, lotDepth] of [
      [1, 1],
      [2, 1],
      [2, 2],
      [3, 2],
      [2, 3],
    ])
      for (const rotation of [0, 1, 2, 3] as const)
        for (const level of [2, 3, 4]) {
          const tile = {
            ...state.tiles[12 * state.size + 12],
            kind: 'commercial' as const,
            variation,
            lotWidth,
            lotDepth,
            rotation,
            level,
          };
          const model = createTileModel(tile, state);
          model.updateMatrixWorld(true);
          const patches = getFirePatches(tile, state);
          assert.ok(patches.length > 0);
          for (const patch of patches)
            for (const ux of [-0.35, 0, 0.35])
              for (const uz of [-0.35, 0, 0.35]) {
                const x = patch.x + patch.width * ux,
                  z = patch.z + patch.depth * uz,
                  y = firePatchHeight(patch, x, z);
                ray.ray.origin.set(x, y + 20, z);
                const hit = ray.intersectObject(model, true)[0];
                assert.ok(
                  hit && Math.abs(hit.point.y - y) < 0.003,
                  `commercial v${variation} L${level} ${lotWidth}x${lotDepth} rotation ${rotation}: sample must touch visible roof`,
                );
              }
        }
});
