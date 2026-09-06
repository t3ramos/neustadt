/** Planar rigid bodies. Positive yaw rotates the vehicle's +Z nose towards +X. */
export interface VehicleContactBody {
  x: number;
  z: number;
  y: number;
  yaw: number;
  vx: number;
  vz: number;
  angularVelocity: number;
  halfWidth: number;
  halfLength: number;
  height: number;
  mass: number;
}

export interface VehicleContact {
  /** Unit normal from the first body towards the second body. */
  normal: { x: number; z: number };
  penetration: number;
  point: { x: number; z: number };
}

export interface VehicleContactResolution {
  contact: VehicleContact;
  /** Approach speed at the contact, including the vehicles' angular velocity. */
  closingSpeed: number;
  /** Magnitude of the normal impulse; zero for an already separating contact. */
  impulse: number;
}

/** Omit y when the ground/base height did not change during this frame. */
export interface VehicleContactPose {
  x: number;
  z: number;
  yaw: number;
  y?: number;
}
export interface SweptVehicleContact extends VehicleContact {
  time: number;
}

interface Vector {
  x: number;
  z: number;
}
interface AxisOverlap {
  normal: Vector;
  overlap: number;
}

const CONTACT_EPSILON = 1e-7;
const RESTITUTION = 0.18;
const FRICTION = 0.35;
const MAX_ANGULAR_SPEED = 8;
const MAX_SWEEP_ITERATIONS = 64;

const dot = (a: Vector, b: Vector): number => a.x * b.x + a.z * b.z;
// A THREE-style positive Y rotation has the opposite sign to a 2D XY cross product.
const crossYaw = (a: Vector, b: Vector): number => a.z * b.x - a.x * b.z;
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

function validGeometry(body: VehicleContactBody): boolean {
  return (
    [body.x, body.z, body.y, body.yaw, body.halfWidth, body.halfLength, body.height].every(
      Number.isFinite,
    ) &&
    body.halfWidth > 0 &&
    body.halfLength > 0 &&
    body.height > 0
  );
}

function axes(body: VehicleContactBody): [Vector, Vector] {
  const sin = Math.sin(body.yaw),
    cos = Math.cos(body.yaw);
  return [
    { x: cos, z: -sin },
    { x: sin, z: cos },
  ];
}

function projectionRadius(body: VehicleContactBody, basis: [Vector, Vector], axis: Vector): number {
  return (
    body.halfWidth * Math.abs(dot(basis[0], axis)) + body.halfLength * Math.abs(dot(basis[1], axis))
  );
}

function axisOverlaps(a: VehicleContactBody, b: VehicleContactBody): AxisOverlap[] {
  const aAxes = axes(a),
    bAxes = axes(b),
    delta = { x: b.x - a.x, z: b.z - a.z };
  return [...aAxes, ...bAxes].map((axis) => {
    const distance = dot(delta, axis);
    return {
      normal: distance < 0 ? { x: -axis.x, z: -axis.z } : axis,
      overlap:
        projectionRadius(a, aAxes, axis) + projectionRadius(b, bAxes, axis) - Math.abs(distance),
    };
  });
}

function corners(body: VehicleContactBody): Vector[] {
  const [right, forward] = axes(body);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([width, length]) => ({
    x: body.x + right.x * width * body.halfWidth + forward.x * length * body.halfLength,
    z: body.z + right.z * width * body.halfWidth + forward.z * length * body.halfLength,
  }));
}

/** Face midpoints, rather than an arbitrary tied support corner, avoid head-on spin. */
function supportCenter(vertices: Vector[], axis: Vector): Vector {
  const maximum = Math.max(...vertices.map((vertex) => dot(vertex, axis)));
  const face = vertices.filter((vertex) => maximum - dot(vertex, axis) <= CONTACT_EPSILON);
  return {
    x: face.reduce((sum, p) => sum + p.x, 0) / face.length,
    z: face.reduce((sum, p) => sum + p.z, 0) / face.length,
  };
}

function contactPoint(a: VehicleContactBody, b: VehicleContactBody, normal: Vector): Vector {
  const aCorners = corners(a),
    bCorners = corners(b);
  let polygon = aCorners;
  // Clip the actual oriented rectangles, retaining an unbiased face/edge contact centroid.
  for (let edgeIndex = 0; edgeIndex < bCorners.length && polygon.length; edgeIndex++) {
    const first = bCorners[edgeIndex],
      next = bCorners[(edgeIndex + 1) % bCorners.length];
    const edge = { x: next.x - first.x, z: next.z - first.z };
    const distance = (p: Vector): number => edge.x * (p.z - first.z) - edge.z * (p.x - first.x);
    const output: Vector[] = [];
    let previous = polygon[polygon.length - 1],
      previousDistance = distance(previous);
    for (const point of polygon) {
      const pointDistance = distance(point);
      const previousInside = previousDistance >= -CONTACT_EPSILON,
        pointInside = pointDistance >= -CONTACT_EPSILON;
      if (pointInside !== previousInside) {
        const fraction = clamp(previousDistance / (previousDistance - pointDistance), 0, 1);
        output.push({
          x: previous.x + (point.x - previous.x) * fraction,
          z: previous.z + (point.z - previous.z) * fraction,
        });
      }
      if (pointInside) output.push(point);
      previous = point;
      previousDistance = pointDistance;
    }
    polygon = output;
  }
  if (polygon.length) {
    let area = 0,
      x = 0,
      z = 0;
    // Relative coordinates keep the centroid stable for tiny overlaps far from the origin.
    const origin = polygon[0];
    for (let index = 1; index < polygon.length - 1; index++) {
      const p = polygon[index],
        q = polygon[index + 1];
      const twiceArea = (p.x - origin.x) * (q.z - origin.z) - (q.x - origin.x) * (p.z - origin.z);
      area += twiceArea;
      x += (origin.x + p.x + q.x) * twiceArea;
      z += (origin.z + p.z + q.z) * twiceArea;
    }
    if (Math.abs(area) > CONTACT_EPSILON * CONTACT_EPSILON)
      return { x: x / (3 * area), z: z / (3 * area) };
    return {
      x: polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length,
      z: polygon.reduce((sum, p) => sum + p.z, 0) / polygon.length,
    };
  }
  const faceA = supportCenter(aCorners, normal),
    faceB = supportCenter(bCorners, { x: -normal.x, z: -normal.z });
  return { x: (faceA.x + faceB.x) / 2, z: (faceA.z + faceB.z) / 2 };
}

/** Actual rotated OBB intersection. y is the body base, not its center. */
export function findVehicleContact(
  a: VehicleContactBody,
  b: VehicleContactBody,
): VehicleContact | null {
  if (!validGeometry(a) || !validGeometry(b)) return null;
  if (a.y + a.height <= b.y || b.y + b.height <= a.y) return null;
  const overlaps = axisOverlaps(a, b);
  let minimum = overlaps[0];
  for (const overlap of overlaps) {
    if (overlap.overlap < -CONTACT_EPSILON) return null;
    if (overlap.overlap < minimum.overlap) minimum = overlap;
  }
  return {
    normal: minimum.normal,
    penetration: Math.max(0, minimum.overlap),
    point: contactPoint(a, b, minimum.normal),
  };
}

/** Non-positive or infinite mass represents an immovable body. */
function inverseMass(body: VehicleContactBody): number {
  return Number.isFinite(body.mass) && body.mass > 0 ? 1 / body.mass : 0;
}

function inverseInertia(body: VehicleContactBody, invMass: number): number {
  return (3 * invMass) / (body.halfWidth * body.halfWidth + body.halfLength * body.halfLength);
}

function relativeContactVelocity(
  a: VehicleContactBody,
  b: VehicleContactBody,
  armA: Vector,
  armB: Vector,
): Vector {
  return {
    x: b.vx + b.angularVelocity * armB.z - a.vx - a.angularVelocity * armA.z,
    z: b.vz - b.angularVelocity * armB.x - a.vz + a.angularVelocity * armA.x,
  };
}

/** Mass-weighted separation plus inelastic normal/friction impulses; never a velocity kick on separating pairs. */
export function resolveVehicleContact(
  a: VehicleContactBody,
  b: VehicleContactBody,
): VehicleContactResolution | null {
  const contact = findVehicleContact(a, b);
  if (
    !contact ||
    ![a.vx, a.vz, a.angularVelocity, b.vx, b.vz, b.angularVelocity].every(Number.isFinite)
  )
    return null;
  const invMassA = inverseMass(a),
    invMassB = inverseMass(b),
    totalInvMass = invMassA + invMassB;
  const invIA = inverseInertia(a, invMassA),
    invIB = inverseInertia(b, invMassB);
  const armA = { x: contact.point.x - a.x, z: contact.point.z - a.z },
    armB = { x: contact.point.x - b.x, z: contact.point.z - b.z };
  const relative = relativeContactVelocity(a, b, armA, armB);
  const normalSpeed = dot(relative, contact.normal),
    closingSpeed = Math.max(0, -normalSpeed);
  let impulse = 0;
  const denominator = (direction: Vector): number =>
    totalInvMass + crossYaw(armA, direction) ** 2 * invIA + crossYaw(armB, direction) ** 2 * invIB;
  const apply = (direction: Vector, magnitude: number): void => {
    a.vx -= direction.x * magnitude * invMassA;
    a.vz -= direction.z * magnitude * invMassA;
    b.vx += direction.x * magnitude * invMassB;
    b.vz += direction.z * magnitude * invMassB;
    a.angularVelocity -= crossYaw(armA, direction) * magnitude * invIA;
    b.angularVelocity += crossYaw(armB, direction) * magnitude * invIB;
  };
  if (totalInvMass > 0 && normalSpeed < 0) {
    const restitution = closingSpeed < 0.06 ? 0 : RESTITUTION;
    impulse = (-(1 + restitution) * normalSpeed) / denominator(contact.normal);
    apply(contact.normal, impulse);
    const afterNormal = relativeContactVelocity(a, b, armA, armB);
    const alongNormal = dot(afterNormal, contact.normal);
    const tangentVelocity = {
      x: afterNormal.x - alongNormal * contact.normal.x,
      z: afterNormal.z - alongNormal * contact.normal.z,
    };
    const tangentSpeed = Math.hypot(tangentVelocity.x, tangentVelocity.z);
    if (tangentSpeed > CONTACT_EPSILON) {
      const tangent = { x: tangentVelocity.x / tangentSpeed, z: tangentVelocity.z / tangentSpeed };
      const frictionImpulse = -Math.min(tangentSpeed / denominator(tangent), FRICTION * impulse);
      apply(tangent, frictionImpulse);
    }
    // A collision may dissipate angular energy, but it must never create an unbounded spin.
    if (invMassA)
      a.angularVelocity = clamp(a.angularVelocity, -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED);
    if (invMassB)
      b.angularVelocity = clamp(b.angularVelocity, -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED);
    // Friction couples translation and spin. Enforce a separating contact again after
    // friction/the spin limit, otherwise a glancing pair immediately hits itself again.
    const finalNormalSpeed = dot(relativeContactVelocity(a, b, armA, armB), contact.normal);
    if (finalNormalSpeed < 0) {
      const crossA = crossYaw(armA, contact.normal),
        crossB = crossYaw(armB, contact.normal);
      const projectedNormalSpeed = (extraImpulse: number): number =>
        finalNormalSpeed +
        extraImpulse * totalInvMass +
        (invMassB
          ? clamp(
              b.angularVelocity + crossB * extraImpulse * invIB,
              -MAX_ANGULAR_SPEED,
              MAX_ANGULAR_SPEED,
            ) - b.angularVelocity
          : 0) *
          crossB -
        (invMassA
          ? clamp(
              a.angularVelocity - crossA * extraImpulse * invIA,
              -MAX_ANGULAR_SPEED,
              MAX_ANGULAR_SPEED,
            ) - a.angularVelocity
          : 0) *
          crossA;
      let low = 0,
        high = -finalNormalSpeed / totalInvMass;
      for (let iteration = 0; iteration < 30; iteration++) {
        const middle = (low + high) / 2;
        if (projectedNormalSpeed(middle) < 0) low = middle;
        else high = middle;
      }
      apply(contact.normal, high);
      if (invMassA)
        a.angularVelocity = clamp(a.angularVelocity, -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED);
      if (invMassB)
        b.angularVelocity = clamp(b.angularVelocity, -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED);
      impulse += high;
    }
  }
  if (totalInvMass > 0) {
    const separation = (contact.penetration + CONTACT_EPSILON * 2) / totalInvMass;
    a.x -= contact.normal.x * separation * invMassA;
    a.z -= contact.normal.z * separation * invMassA;
    b.x += contact.normal.x * separation * invMassB;
    b.z += contact.normal.z * separation * invMassB;
  }
  return { contact, closingSpeed, impulse };
}

function shortestAngle(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * A rectangle's projection hw|cos θ|+hl|sin θ| is concave between quadrant
 * crossings. Its current one-sided derivative bounds support growth until the
 * next crossing, much tighter than a global corner-speed bound for grazing hits.
 */
function projectionGrowth(
  body: VehicleContactBody,
  axis: Vector,
  angle: number,
): { rate: number; horizon: number } {
  if (Math.abs(angle) < 1e-12) return { rate: 0, horizon: Infinity };
  const theta = body.yaw + Math.atan2(axis.z, axis.x),
    sin = Math.sin(theta),
    cos = Math.cos(theta);
  const cosSign = Math.abs(cos) < 1e-10 ? Math.sign(-angle * sin) : Math.sign(cos);
  const sinSign = Math.abs(sin) < 1e-10 ? Math.sign(angle * cos) : Math.sign(sin);
  const rate = angle * (-body.halfWidth * cosSign * sin + body.halfLength * sinSign * cos);
  const quadrant = theta / (Math.PI / 2);
  const nextQuadrant =
    angle > 0 ? Math.floor(quadrant + 1e-10) + 1 : Math.ceil(quadrant - 1e-10) - 1;
  return { rate, horizon: ((nextQuadrant * Math.PI) / 2 - theta) / angle };
}

/**
 * Read-only continuous query, returning first contact at a normalized frame time.
 * The caller can rewind the two poses to time before calling resolveVehicleContact.
 * Conservative advancement bounds movement along every separating axis, including
 * rotating corners, so fast translation cannot jump over a narrow stationary car.
 */
export function sweepVehicleContact(
  aPrevious: VehicleContactPose,
  aCurrent: VehicleContactBody,
  bPrevious: VehicleContactPose,
  bCurrent: VehicleContactBody,
): SweptVehicleContact | null {
  if (
    !validGeometry(aCurrent) ||
    !validGeometry(bCurrent) ||
    ![
      aPrevious.x,
      aPrevious.z,
      aPrevious.yaw,
      bPrevious.x,
      bPrevious.z,
      bPrevious.yaw,
      aPrevious.y ?? aCurrent.y,
      bPrevious.y ?? bCurrent.y,
    ].every(Number.isFinite)
  )
    return null;
  const radiusA = Math.hypot(aCurrent.halfWidth, aCurrent.halfLength),
    radiusB = Math.hypot(bCurrent.halfWidth, bCurrent.halfLength);
  const combinedRadius = radiusA + radiusB;
  // Swept bounding circles enclose every intermediate orientation.
  for (const component of ['x', 'z'] as const) {
    if (
      Math.max(aPrevious[component], aCurrent[component]) + combinedRadius <
        Math.min(bPrevious[component], bCurrent[component]) ||
      Math.max(bPrevious[component], bCurrent[component]) + combinedRadius <
        Math.min(aPrevious[component], aCurrent[component])
    )
      return null;
  }
  const aStartY = aPrevious.y ?? aCurrent.y,
    bStartY = bPrevious.y ?? bCurrent.y;
  const aDy = aCurrent.y - aStartY,
    bDy = bCurrent.y - bStartY;
  const relativeY = bStartY - aStartY,
    relativeDy = bDy - aDy;
  let start = 0,
    end = 1;
  if (Math.abs(relativeDy) < 1e-12) {
    if (relativeY >= aCurrent.height || relativeY <= -bCurrent.height) return null;
  } else {
    const first = (-bCurrent.height - relativeY) / relativeDy,
      last = (aCurrent.height - relativeY) / relativeDy;
    // Nudge inside the vertical interval: touching roofs/undersides is not a planar impact.
    start = Math.max(0, Math.min(first, last) + 1e-9);
    end = Math.min(1, Math.max(first, last) - 1e-9);
    if (start > end) return null;
  }
  const aDx = aCurrent.x - aPrevious.x,
    aDz = aCurrent.z - aPrevious.z;
  const bDx = bCurrent.x - bPrevious.x,
    bDz = bCurrent.z - bPrevious.z;
  const aAngle = shortestAngle(aPrevious.yaw, aCurrent.yaw),
    bAngle = shortestAngle(bPrevious.yaw, bCurrent.yaw);
  const relativeMovement = { x: bDx - aDx, z: bDz - aDz };
  const a = { ...aCurrent },
    b = { ...bCurrent };
  let time = start,
    checks = 0,
    lastProbe = 0;
  const contactAt = (time: number): VehicleContact | null => {
    checks++;
    a.x = aPrevious.x + aDx * time;
    a.z = aPrevious.z + aDz * time;
    a.y = aStartY + aDy * time;
    a.yaw = aPrevious.yaw + aAngle * time;
    b.x = bPrevious.x + bDx * time;
    b.z = bPrevious.z + bDz * time;
    b.y = bStartY + bDy * time;
    b.yaw = bPrevious.yaw + bAngle * time;
    return findVehicleContact(a, b);
  };
  while (checks < MAX_SWEEP_ITERATIONS && time <= end + 1e-12) {
    const contact = contactAt(time);
    if (contact) return { ...contact, time: clamp(time, 0, 1) };
    let advancement = 0,
      largestGap = 0;
    for (const axis of axisOverlaps(a, b)) {
      if (axis.overlap >= -CONTACT_EPSILON) continue;
      largestGap = Math.max(largestGap, -axis.overlap);
      // Holding this world-space axis fixed is conservative even when either OBB rotates.
      const aGrowth = projectionGrowth(a, axis.normal, aAngle),
        bGrowth = projectionGrowth(b, axis.normal, bAngle);
      const horizon = Math.min(aGrowth.horizon, bGrowth.horizon, end - time);
      const closingBound = -dot(relativeMovement, axis.normal) + aGrowth.rate + bGrowth.rate;
      const safeAdvance =
        closingBound > 0 ? Math.min(horizon, -axis.overlap / closingBound) : horizon;
      advancement = Math.max(advancement, safeAdvance);
    }
    if (advancement <= 0 || time + advancement > end + 1e-12) return null;
    // A nearly tangent rotating contact can converge slowly on changing SAT axes.
    // Probe a little further, then refine only a verified bracket. Failed probes
    // never advance time, and all probes/refinement share the same 64-query budget.
    if (checks >= 16 && checks <= 40 && checks - lastProbe >= 8 && largestGap < 0.002) {
      lastProbe = checks;
      let high = Math.min(end, time + advancement * 32),
        low = time;
      let highContact = contactAt(high);
      if (highContact) {
        for (
          let iteration = 0;
          iteration < 20 && checks < MAX_SWEEP_ITERATIONS && high - low > 1e-10;
          iteration++
        ) {
          const middle = (low + high) / 2,
            middleContact = contactAt(middle);
          if (middleContact) {
            high = middle;
            highContact = middleContact;
          } else low = middle;
        }
        return { ...highContact, time: high };
      }
    }
    time = Math.min(end, time + advancement);
  }
  return null;
}
