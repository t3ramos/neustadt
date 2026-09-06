import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceVehicleSupportPose } from '../../src/rendering/scene';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
test('autonomous service suspension keeps flat paving clearance and matches ramp inclination in all headings', () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const fx = Math.sin(yaw),
      fz = Math.cos(yaw),
      rx = Math.cos(yaw),
      rz = -Math.sin(yaw);
    const forwardSlope = 0.45,
      sideSlope = -0.18,
      base = 0.057;
    const sample = (x: number, z: number) =>
      base + (x * fx + z * fz) * forwardSlope + (x * rx + z * rz) * sideSlope;
    const pose = serviceVehicleSupportPose(sample, 0, 0, yaw, 0.3365, 0.237);
    near(pose.y, base);
    near(pose.pitch, -Math.atan(forwardSlope));
    near(pose.roll, Math.atan(sideSlope));
  }
  const flat = serviceVehicleSupportPose(() => 2.057, 6, 7, 0.4, 0.21, 0.19);
  near(flat.y, 2.057);
  near(flat.pitch, 0);
  near(flat.roll, 0);
});
test('autonomous service suspension clears a crest under its centre and a supported wheel axle in a dip', () => {
  const crest = serviceVehicleSupportPose(
    (x, z) => 0.057 + Math.max(0, 0.08 - Math.abs(z)),
    0,
    0,
    0,
    0.3365,
    0.237,
  );
  near(crest.y, 0.137);
  near(crest.pitch, 0);
  const dip = serviceVehicleSupportPose(
    (_x, z) => 0.057 + Math.abs(z) * 0.4,
    0,
    0,
    0,
    0.3365,
    0.237,
  );
  near(dip.y, 0.057 + (0.3365 / 2) * 0.4);
  near(dip.pitch, 0);
});
