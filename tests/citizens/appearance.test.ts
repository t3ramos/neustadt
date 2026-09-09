import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  citizenLimbJoint,
  createCitizenMaterials,
  createCitizenShoeGeometry,
} from '../../src/citizens/appearance.ts';
import { citizenWalkingGait, CITIZEN_SCALE } from '../../src/citizens/system.ts';

test('visual knees preserve thigh/shin length and the planted gait endpoint over a full stride', () => {
  const scale = CITIZEN_SCALE,
    start = new THREE.Vector3(0, 0.21 * scale, 0),
    end = new THREE.Vector3(),
    joint = new THREE.Vector3(),
    scratch = new THREE.Vector3(),
    forward = new THREE.Vector3(0, 0, 1);
  let minBend = Infinity,
    maxBend = 0;
  for (let step = 0; step <= 120; step++) {
    const gait = citizenWalkingGait((step / 120) * Math.PI * 2, scale);
    for (const foot of [gait.left, gait.right]) {
      end.set(0, 0.021 * scale + foot.lift, foot.forward);
      const before = end.clone();
      citizenLimbJoint(start, end, forward, 0.108 * scale, 1, joint, scratch);
      assert.ok(Math.abs(start.distanceTo(joint) - 0.108 * scale) < 1e-9);
      assert.ok(Math.abs(end.distanceTo(joint) - 0.108 * scale) < 1e-9);
      assert.deepEqual(end, before, 'Knee articulation must not move the foot target');
      const bend = joint.distanceTo(start.clone().add(end).multiplyScalar(0.5));
      minBend = Math.min(minBend, bend);
      maxBend = Math.max(maxBend, bend);
      assert.ok(joint.z > (start.z + end.z) / 2, 'Knees bend forward');
    }
  }
  assert.ok(maxBend > minBend * 1.5, 'Swing visibly flexes the knee more than extended stance');
});

test('visual articulation handles physics-straight, unreachable and collapsed limbs without NaNs', () => {
  const start = new THREE.Vector3(0, 1, 0),
    end = new THREE.Vector3(),
    joint = new THREE.Vector3(),
    scratch = new THREE.Vector3(),
    forward = new THREE.Vector3(0, 0, 1);
  citizenLimbJoint(start, end, forward, 0.6, 0, joint, scratch);
  assert.deepEqual(joint.toArray(), [0, 0.5, 0]);
  citizenLimbJoint(start, end, forward, 0.2, 1, joint, scratch);
  assert.deepEqual(joint.toArray(), [0, 0.5, 0]);
  citizenLimbJoint(start, start, forward, 0.6, 1, joint, scratch);
  assert.deepEqual(joint, start);
});

test('citizens use reusable skin, fabric, hair and leather surface responses', () => {
  const materials = createCitizenMaterials();
  assert.ok(materials.cloth.roughness > materials.skin.roughness);
  assert.ok(materials.hair.roughness > materials.leather.roughness);
  for (const material of Object.values(materials)) {
    assert.equal(material.map, null, 'Appearance must not depend on network assets');
    material.dispose();
  }
});

test('shoes have a narrower heel and rounded toe within the existing unit foot envelope', () => {
  const geometry = createCitizenShoeGeometry();
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  assert.ok(bounds.min.y >= -0.5 && bounds.max.y <= 0.5);
  assert.ok(bounds.min.z >= -0.5 && bounds.max.z <= 0.5);
  assert.ok(bounds.max.x < 0.5);
  const positions = geometry.getAttribute('position');
  let heelWidth = 0,
    ballWidth = 0,
    toeWidth = 0;
  for (let i = 0; i < positions.count; i++) {
    const z = positions.getZ(i),
      x = Math.abs(positions.getX(i));
    if (z < -0.3) heelWidth = Math.max(heelWidth, x);
    if (z > 0 && z < 0.35) ballWidth = Math.max(ballWidth, x);
    if (z > 0.4) toeWidth = Math.max(toeWidth, x);
  }
  assert.ok(heelWidth < ballWidth * 0.8);
  assert.ok(toeWidth < ballWidth * 0.8);
  geometry.dispose();
});
