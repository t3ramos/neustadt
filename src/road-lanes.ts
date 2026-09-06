import type { Point } from './types.ts';

/** Distance from a road's centre line, in grid tiles. */
export const ROAD_LANE_OFFSET = .16;

export interface LanePose {
  x: number;
  z: number;
  tangentX: number;
  tangentZ: number;
  /** Vehicle yaw: +Z is zero, +X is Math.PI / 2. */
  yaw: number;
  pathLength: number;
}

type Controls = readonly [Point, Point] | readonly [Point, Point, Point] | readonly [Point, Point, Point, Point];
interface LaneCurve {
  controls: Controls;
  incoming: Point;
  outgoing: Point;
  distances: Float64Array;
  length: number;
}

const ARC_SAMPLES = 128;
const curves = new Map<string, LaneCurve>();
const EPSILON = 1e-10;

function direction(a: Point, b: Point): Point | undefined {
  const x = b.x - a.x, z = b.z - a.z, length = Math.hypot(x, z);
  return length > EPSILON ? { x: x / length, z: z / length } : undefined;
}

function curvePoint(controls: Controls, t: number): Point {
  const a = controls[0], end = controls[controls.length - 1], s = 1 - t;
  if (controls.length === 2) return { x: a.x * s + end.x * t, z: a.z * s + end.z * t };
  const b = controls[1];
  if (controls.length === 3) return {
    x: s * s * a.x + 2 * s * t * b.x + t * t * end.x,
    z: s * s * a.z + 2 * s * t * b.z + t * t * end.z,
  };
  const c = controls[2];
  return {
    x: s * s * s * a.x + 3 * s * s * t * b.x + 3 * s * t * t * c.x + t * t * t * end.x,
    z: s * s * s * a.z + 3 * s * s * t * b.z + 3 * s * t * t * c.z + t * t * t * end.z,
  };
}

function curveTangent(curve: LaneCurve, t: number): Point {
  const controls = curve.controls, a = controls[0], b = controls[1], s = 1 - t;
  let x = b.x - a.x, z = b.z - a.z;
  if (controls.length === 3) {
    const c = controls[2];
    x = 2 * (s * (b.x - a.x) + t * (c.x - b.x));
    z = 2 * (s * (b.z - a.z) + t * (c.z - b.z));
  } else if (controls.length === 4) {
    const c = controls[2], d = controls[3];
    x = 3 * (s * s * (b.x - a.x) + 2 * s * t * (c.x - b.x) + t * t * (d.x - c.x));
    z = 3 * (s * s * (b.z - a.z) + 2 * s * t * (c.z - b.z) + t * t * (d.z - c.z));
  }
  const length = Math.hypot(x, z);
  // A zero-width U-turn can have a stationary cusp. Keep its heading finite.
  return length > EPSILON ? { x: x / length, z: z / length } : t < .5 ? curve.incoming : curve.outgoing;
}

function laneCurve(previous: Point, from: Point, to: Point, laneOffset: number): LaneCurve {
  const incomingDirection = direction(previous, from), outgoingDirection = direction(from, to);
  const incoming = incomingDirection ?? outgoingDirection ?? { x: 0, z: 1 };
  const outgoing = outgoingDirection ?? incoming;
  const offset = Number.isFinite(laneOffset) ? laneOffset : ROAD_LANE_OFFSET;
  const key = `${incoming.x},${incoming.z}:${outgoing.x},${outgoing.z}:${offset}`;
  const cached = curves.get(key);
  if (cached) return cached;

  const entry = { x: -.5 * incoming.x - incoming.z * offset, z: -.5 * incoming.z + incoming.x * offset };
  const exit = { x: .5 * outgoing.x - outgoing.z * offset, z: .5 * outgoing.z + outgoing.x * offset };
  const cross = incoming.x * outgoing.z - incoming.z * outgoing.x;
  const dot = incoming.x * outgoing.x + incoming.z * outgoing.z;
  let controls: Controls;
  if (Math.abs(cross) < EPSILON && dot > 0) {
    controls = [entry, exit];
  } else if (Math.abs(cross) > EPSILON) {
    // Intersect the entry's forward tangent with the exit's backward tangent.
    const delta = { x: exit.x - entry.x, z: exit.z - entry.z };
    const reach = (delta.x * outgoing.z - delta.z * outgoing.x) / cross;
    const control = { x: entry.x + incoming.x * reach, z: entry.z + incoming.z * reach };
    const exitReach = (exit.x - control.x) * outgoing.x + (exit.z - control.z) * outgoing.z;
    // Cardinal road corners use one quadratic, entirely within their tile.
    // The bounded cubic also keeps non-cardinal or unusual offsets well-behaved.
    controls = reach > EPSILON && exitReach > EPSILON && reach <= 2 && exitReach <= 2
      ? [entry, control, exit]
      : [entry, { x: entry.x + incoming.x * .5, z: entry.z + incoming.z * .5 },
        { x: exit.x - outgoing.x * .5, z: exit.z - outgoing.z * .5 }, exit];
  } else {
    // At a dead end, turn around inside the tile instead of snapping lanes.
    controls = [entry, { x: entry.x + incoming.x * .5, z: entry.z + incoming.z * .5 },
      { x: exit.x - outgoing.x * .5, z: exit.z - outgoing.z * .5 }, exit];
  }

  const distances = new Float64Array(ARC_SAMPLES + 1);
  let last = entry;
  for (let n = 1; n <= ARC_SAMPLES; n++) {
    const current = curvePoint(controls, n / ARC_SAMPLES);
    distances[n] = distances[n - 1] + Math.hypot(current.x - last.x, current.z - last.z);
    last = current;
  }
  const curve = { controls, incoming, outgoing, distances, length: distances[ARC_SAMPLES] };
  // Ordinary roads need only 16 shapes. Bound the cache for custom callers.
  if (curves.size >= 128) curves.clear();
  curves.set(key, curve);
  return curve;
}

/** Length of the path through `from`, from its incoming edge to its outgoing edge. */
export function lanePathLength(previous: Point, from: Point, to: Point, laneOffset = ROAD_LANE_OFFSET): number {
  return laneCurve(previous, from, to, laneOffset).length;
}

/**
 * Sample the right-hand lane through one tile, in grid coordinates.
 * `progress` is the fraction of distance travelled (clamped to 0..1), not a
 * Bezier parameter. Neighbouring tiles share exactly the same edge pose.
 * For a newly assigned route, `previous === from` uses the outgoing heading.
 */
export function lanePose(previous: Point, from: Point, to: Point, progress: number, laneOffset = ROAD_LANE_OFFSET): LanePose {
  const curve = laneCurve(previous, from, to, laneOffset);
  const fraction = Number.isNaN(progress) ? 0 : Math.max(0, Math.min(1, progress));
  let t = fraction;
  if (fraction > 0 && fraction < 1 && curve.controls.length > 2) {
    const target = curve.length * fraction;
    let low = 0, high = ARC_SAMPLES;
    while (high - low > 1) {
      const middle = (low + high) >>> 1;
      if (curve.distances[middle] < target) low = middle;
      else high = middle;
    }
    const span = curve.distances[high] - curve.distances[low];
    t = (low + (span > EPSILON ? (target - curve.distances[low]) / span : 0)) / ARC_SAMPLES;
  }
  const point = curvePoint(curve.controls, t), tangent = curveTangent(curve, t);
  return {
    x: from.x + .5 + point.x,
    z: from.z + .5 + point.z,
    tangentX: tangent.x,
    tangentZ: tangent.z,
    yaw: Math.atan2(tangent.x, tangent.z),
    pathLength: curve.length,
  };
}
