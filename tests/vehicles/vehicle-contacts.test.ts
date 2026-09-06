import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findVehicleContact,
  resolveVehicleContact,
  sweepVehicleContact,
  type VehicleContactBody,
} from '../../src/vehicles/contacts.ts';

function body(values: Partial<VehicleContactBody> = {}): VehicleContactBody {
  return {
    x: 0,
    z: 0,
    y: 0,
    yaw: 0,
    vx: 0,
    vz: 0,
    angularVelocity: 0,
    halfWidth: 0.1,
    halfLength: 0.2,
    height: 0.15,
    mass: 1,
    ...values,
  };
}
function close(actual: number, expected: number, tolerance = 1e-8): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} must equal ${expected} ± ${tolerance}`,
  );
}
function energy(...bodies: VehicleContactBody[]): number {
  return bodies.reduce(
    (total, car) =>
      total +
      0.5 * car.mass * (car.vx ** 2 + car.vz ** 2) +
      ((0.5 * car.mass * (car.halfWidth ** 2 + car.halfLength ** 2)) / 3) *
        car.angularVelocity ** 2,
    0,
  );
}

test('centered head-on collisions exchange momentum inelastically without artificial spin', () => {
  const a = body({ z: -0.195, vz: 20 }),
    b = body({ z: 0.195, vz: -20 });
  const before = energy(a, b),
    result = resolveVehicleContact(a, b);
  assert.ok(result);
  close(result.closingSpeed, 40);
  close(result.impulse, 23.6);
  close(a.vz, -3.6);
  close(b.vz, 3.6);
  close(a.vx, 0);
  close(b.vx, 0);
  close(a.angularVelocity, 0);
  close(b.angularVelocity, 0);
  assert.ok(energy(a, b) < before);
  assert.equal(findVehicleContact(a, b), null);
});

test('a truck receives less displacement and velocity from a lighter car', () => {
  const a = body({ z: -0.19, vz: 10 }),
    b = body({ z: 0.19, mass: 3 });
  const startA = a.z,
    startB = b.z,
    result = resolveVehicleContact(a, b);
  assert.ok(result);
  close(a.vz + 3 * b.vz, 10);
  close(a.vz, 1.15);
  close(b.vz, 2.95);
  close((startA - a.z) / (b.z - startB), 3);
});

test('off-center impacts deflect and rotate vehicles in the physical yaw direction with bounded energy', () => {
  const a = body({ z: -0.19, vz: 15 }),
    b = body({ x: 0.15, z: 0.19 });
  const before = energy(a, b),
    result = resolveVehicleContact(a, b);
  assert.ok(result && result.impulse > 0);
  assert.ok(a.angularVelocity > 0, 'A right-front bumper hit turns the car towards +X');
  assert.ok(b.angularVelocity > 0, 'The struck left-rear corner turns in the same yaw direction');
  assert.ok(Math.abs(a.angularVelocity) <= 8 && Math.abs(b.angularVelocity) <= 8);
  assert.ok(energy(a, b) <= before + 1e-8);
  close(a.vx + b.vx, 0);
  close(a.vz + b.vz, 15);
});

test('friction reduces contact sliding without adding energy or losing linear momentum', () => {
  const a = body({ z: -0.19, vx: 1, vz: 2 }),
    b = body({ z: 0.19 });
  const before = energy(a, b),
    result = resolveVehicleContact(a, b);
  assert.ok(result);
  assert.ok(a.vx < 1 && b.vx > 0);
  close(a.vx + b.vx, 1);
  close(a.vz + b.vz, 2);
  assert.ok(energy(a, b) <= before);
});

test('glancing friction and the angular limit never leave the same contact approaching again', () => {
  for (const speed of [2.5, 15, 150]) {
    const a = body({ z: -0.19, vz: speed }),
      b = body({ x: 0.15, z: 0.19 });
    const beforeA = { ...a },
      beforeB = { ...b },
      beforeEnergy = energy(a, b);
    const result = resolveVehicleContact(a, b);
    assert.ok(result);
    const armA = { x: result.contact.point.x - beforeA.x, z: result.contact.point.z - beforeA.z };
    const armB = { x: result.contact.point.x - beforeB.x, z: result.contact.point.z - beforeB.z };
    const relativeX = b.vx + b.angularVelocity * armB.z - a.vx - a.angularVelocity * armA.z;
    const relativeZ = b.vz - b.angularVelocity * armB.x - a.vz + a.angularVelocity * armA.x;
    const outgoing = relativeX * result.contact.normal.x + relativeZ * result.contact.normal.z;
    assert.ok(outgoing >= -1e-8, `Contact approaches again at ${outgoing}`);
    assert.ok(energy(a, b) <= beforeEnergy + 1e-8);
    assert.ok(Math.abs(a.angularVelocity) <= 8 && Math.abs(b.angularVelocity) <= 8);
  }
});

test('an immovable rotating body keeps its prescribed motion while its contact response separates', () => {
  const a = body({ z: -0.19, vz: 15 }),
    b = body({ x: -0.15, z: 0.19, mass: 0, angularVelocity: 20 });
  const beforeA = { ...a },
    beforeB = { ...b },
    result = resolveVehicleContact(a, b);
  assert.ok(result);
  assert.deepEqual(b, beforeB);
  const armA = { x: result.contact.point.x - beforeA.x, z: result.contact.point.z - beforeA.z };
  const armB = { x: result.contact.point.x - beforeB.x, z: result.contact.point.z - beforeB.z };
  const relativeX = b.vx + b.angularVelocity * armB.z - a.vx - a.angularVelocity * armA.z;
  const relativeZ = b.vz - b.angularVelocity * armB.x - a.vz + a.angularVelocity * armA.x;
  assert.ok(relativeX * result.contact.normal.x + relativeZ * result.contact.normal.z >= -1e-8);
});

test('already separating overlap is corrected without a second collision impulse', () => {
  const a = body({ z: -0.19, vz: -2, angularVelocity: 0.2 }),
    b = body({ z: 0.19, vz: 2 });
  const result = resolveVehicleContact(a, b);
  assert.ok(result);
  close(result.impulse, 0);
  close(result.closingSpeed, 0);
  close(a.vz, -2);
  close(b.vz, 2);
  close(a.angularVelocity, 0.2);
  assert.equal(findVehicleContact(a, b), null);
});

test('stationary and coincident bodies are fully separated without inventing velocity', () => {
  const a = body(),
    b = body();
  const result = resolveVehicleContact(a, b);
  assert.ok(result);
  close(result.impulse, 0);
  close(energy(a, b), 0);
  assert.equal(findVehicleContact(a, b), null);
});

test('bodies on separate vertical levels never collide, including exactly touching roofs', () => {
  const a = body(),
    b = body({ y: 0.2 });
  assert.equal(findVehicleContact(a, b), null);
  b.y = a.height;
  assert.equal(findVehicleContact(a, b), null);
  b.y = 0.14;
  assert.ok(findVehicleContact(a, b));
});

test('rotated long trucks use their true oriented footprint rather than a radius or world-aligned box', () => {
  const a = body({ halfLength: 1.1, yaw: Math.PI / 4 });
  const b = body({ x: 0.2, z: -0.2, halfLength: 1.1, yaw: Math.PI / 4 });
  assert.equal(
    findVehicleContact(a, b),
    null,
    'Diagonal bounding boxes overlap, but the truck bodies do not',
  );
  b.x = 0.1;
  b.z = -0.1;
  const contact = findVehicleContact(a, b);
  assert.ok(contact);
  close(contact.normal.x, Math.SQRT1_2);
  close(contact.normal.z, -Math.SQRT1_2);
  close(contact.penetration, 0.2 - Math.SQRT2 * 0.1);
});

test('swapping a nonsymmetric contact reverses the normal and preserves penetration and the world contact', () => {
  const a = body({ x: 0.05, yaw: 0.3 }),
    b = body({ x: 0.18, z: 0.22, yaw: -0.3 });
  const ab = findVehicleContact(a, b),
    ba = findVehicleContact(b, a);
  assert.ok(ab && ba);
  close(ab.normal.x, -ba.normal.x);
  close(ab.normal.z, -ba.normal.z);
  close(ab.penetration, ba.penetration);
  close(ab.point.x, ba.point.x);
  close(ab.point.z, ba.point.z);
});

test('sweep catches fast endpoint-disjoint pass-throughs and leaves its inputs unchanged', () => {
  const a = body({ z: 100, vz: 200 }),
    b = body();
  const originalA = { ...a },
    originalB = { ...b };
  assert.equal(findVehicleContact(a, b), null);
  const contact = sweepVehicleContact({ x: 0, z: -100, yaw: 0 }, a, b, b);
  assert.ok(contact);
  close(contact.time, 0.498, 1e-8);
  close(contact.normal.x, 0);
  close(contact.normal.z, 1);
  close(contact.point.z, -0.2, 1e-7);
  assert.deepEqual(a, originalA);
  assert.deepEqual(b, originalB);
});

test('sweep accounts for both moving vehicles, returns initial overlap immediately, and rejects near misses', () => {
  const a = body({ z: 1 }),
    b = body({ z: -1 });
  const contact = sweepVehicleContact({ x: 0, z: -1, yaw: 0 }, a, { x: 0, z: 1, yaw: 0 }, b);
  assert.ok(contact);
  close(contact.time, 0.4);
  const overlapped = sweepVehicleContact(body(), a, body({ z: 0.3 }), b);
  assert.ok(overlapped);
  close(overlapped.time, 0);
  b.x = 0.201;
  assert.equal(
    sweepVehicleContact({ x: 0, z: -1, yaw: 0 }, a, { x: 0.201, z: 1, yaw: 0 }, b),
    null,
  );
});

test('rotational sweep detects a truck swinging its front into a stationary car', () => {
  const a = body({ yaw: Math.PI / 2, halfLength: 1 }),
    b = body({ x: 0.6, z: 0.6 });
  assert.equal(findVehicleContact({ ...a, yaw: 0 }, b), null);
  assert.equal(findVehicleContact(a, b), null);
  const contact = sweepVehicleContact({ x: 0, z: 0, yaw: 0 }, a, b, b);
  assert.ok(contact);
  assert.ok(contact.time > 0 && contact.time < 0.5);
  const atContact = { ...a, yaw: (Math.PI / 2) * contact.time };
  assert.ok(findVehicleContact(atContact, b));
});

test('grazing trucks with large frame rotations converge within the bounded sweep budget', () => {
  const aPrevious = { x: 1.9819455575197935, z: -0.9462576101068407, yaw: 0.04647978488355875 };
  const a = body({
    x: 1.4300137516111135,
    z: 1.3481044073123485,
    yaw: -1.6064289892092347,
    halfLength: 0.6335953613044694,
  });
  const bPrevious = { x: 2.5030588977970183, z: 0.23646733746863902, yaw: -4.409650646150112 };
  const b = body({
    x: 1.1208558501675725,
    z: -0.7077959028538316,
    yaw: -2.533987711183727,
    halfLength: 0.5767874786863103,
  });
  const contact = sweepVehicleContact(aPrevious, a, bPrevious, b);
  assert.ok(contact);
  assert.ok(contact.time > 0.25 && contact.time < 0.284);
});

test('a nearly tangential changing separating axis is bracketed instead of timing out', () => {
  const aPrevious = { x: -1.634075260721147, z: -0.9987401117105037, yaw: 4.0253453915938735 };
  const a = body({
    x: 0.5383549025282264,
    z: -0.09766528545878828,
    yaw: 2.797851257957518,
    halfLength: 0.6817966312402859,
  });
  const bPrevious = { x: -1.140510241035372, z: 0.3156523529905826, yaw: 0.9238298293203115 };
  const b = body({
    x: -0.5661046598106623,
    z: -0.6506674240808934,
    yaw: -0.9717286610975862,
    halfLength: 0.6805661981226876,
  });
  const contact = sweepVehicleContact(aPrevious, a, bPrevious, b);
  assert.ok(contact);
  assert.ok(contact.time > 0.4 && contact.time < 0.406);
});

test('sweep keeps bridge traffic separate and supports changing base height', () => {
  const a = body({ z: 1 }),
    b = body({ y: 2 });
  assert.equal(sweepVehicleContact({ x: 0, z: -1, yaw: 0 }, a, b, b), null);
  const descending = body({ y: 0 });
  const contact = sweepVehicleContact({ x: 0, z: 0, y: 0.5, yaw: 0 }, descending, body(), body());
  assert.ok(contact);
  close(contact.time, 0.7, 1e-7);
});

test('random glancing impacts dissipate kinetic energy and never create nonfinite or excessive spin', () => {
  let seed = 1729;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  let contacts = 0;
  for (let index = 0; index < 500; index++) {
    const create = (): VehicleContactBody =>
      body({
        x: (random() - 0.5) * 0.3,
        z: (random() - 0.5) * 0.5,
        yaw: random() * Math.PI * 2,
        vx: (random() - 0.5) * 30,
        vz: (random() - 0.5) * 30,
        angularVelocity: (random() - 0.5) * 8,
        mass: 0.5 + random() * 5,
      });
    const a = create(),
      b = create(),
      before = energy(a, b);
    const px = a.mass * a.vx + b.mass * b.vx,
      pz = a.mass * a.vz + b.mass * b.vz;
    const result = resolveVehicleContact(a, b);
    if (!result) continue;
    contacts++;
    assert.ok(energy(a, b) <= before + 1e-7, `Collision ${index} added kinetic energy`);
    close(a.mass * a.vx + b.mass * b.vx, px, 1e-7);
    close(a.mass * a.vz + b.mass * b.vz, pz, 1e-7);
    assert.ok(Number.isFinite(a.angularVelocity) && Math.abs(a.angularVelocity) <= 8);
    assert.ok(Number.isFinite(b.angularVelocity) && Math.abs(b.angularVelocity) <= 8);
  }
  assert.ok(contacts > 300);
});
