import type { Point, Tool } from './types';

export const ZONE_TOOLS = new Set<Tool>(['residential', 'commercial', 'industrial']);
export const LINE_TOOLS = new Set<Tool>(['road', 'rail', 'pipe', 'powerline']);
export const FACILITY_TOOLS = new Set<Tool>(['power', 'waterpump', 'police', 'fire', 'hospital', 'school', 'stadium', 'airport', 'seaport', 'wind', 'solar', 'university', 'recycling']);
export const SINGLE_TILE_TOOLS = new Set<Tool>(['inspect', 'pan', 'citizen', ...LINE_TOOLS, ...ZONE_TOOLS]);

export function brushFootprint(point: Point, tool: Tool, brush: number, size: number): Point[] {
  if (FACILITY_TOOLS.has(tool)) return [{ ...point }];
  const width = SINGLE_TILE_TOOLS.has(tool) ? 1 : Math.max(1, Math.min(12, Math.floor(brush)));
  const offset = Math.floor((width - 1) / 2), points: Point[] = [];
  for (let z = point.z - offset; z < point.z - offset + width; z++) {
    for (let x = point.x - offset; x < point.x - offset + width; x++) {
      if (x >= 0 && z >= 0 && x < size && z < size) points.push({ x, z });
    }
  }
  return points;
}

/** A zone is always the current anchor-to-endpoint rectangle, never its drag history. */
export class ConstructionStroke {
  readonly anchor: Point;
  private endpoint: Point;
  private cells = new Map<number, Point>();
  private cachedPoints: Point[] | null = null;
  revision = 0;

  constructor(readonly tool: Tool, readonly brush: number, readonly size: number, start: Point) {
    this.anchor = { ...start };
    this.endpoint = { ...start };
    if (!ZONE_TOOLS.has(tool)) this.add(start);
  }

  get area(): [number, number] | undefined {
    return ZONE_TOOLS.has(this.tool)
      ? [Math.abs(this.endpoint.x - this.anchor.x) + 1, Math.abs(this.endpoint.z - this.anchor.z) + 1]
      : undefined;
  }

  get points(): Point[] {
    if (this.cachedPoints) return this.cachedPoints;
    if (!ZONE_TOOLS.has(this.tool)) return this.cachedPoints = [...this.cells.values()];
    const points: Point[] = [];
    const x0 = Math.max(0, Math.min(this.anchor.x, this.endpoint.x));
    const x1 = Math.min(this.size - 1, Math.max(this.anchor.x, this.endpoint.x));
    const z0 = Math.max(0, Math.min(this.anchor.z, this.endpoint.z));
    const z1 = Math.min(this.size - 1, Math.max(this.anchor.z, this.endpoint.z));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) points.push({ x, z });
    return this.cachedPoints = points;
  }

  update(point: Point): void {
    if (point.x === this.endpoint.x && point.z === this.endpoint.z || FACILITY_TOOLS.has(this.tool)) return;
    if (!ZONE_TOOLS.has(this.tool)) {
      const from = this.endpoint, dx = point.x - from.x, dz = point.z - from.z;
      if (LINE_TOOLS.has(this.tool)) {
        // Orthogonal steps keep road, rail, and utility routes connected.
        let x = from.x, z = from.z, ix = 0, iz = 0;
        const ax = Math.abs(dx), az = Math.abs(dz);
        while (ix < ax || iz < az) {
          if (ix < ax && (iz >= az || (ix + .5) / Math.max(ax, 1) <= (iz + .5) / Math.max(az, 1))) { x += Math.sign(dx); ix++; }
          else { z += Math.sign(dz); iz++; }
          this.add({ x, z });
        }
      } else {
        const steps = Math.max(Math.abs(dx), Math.abs(dz));
        for (let step = 1; step <= steps; step++) this.add({ x: Math.round(from.x + dx * step / steps), z: Math.round(from.z + dz * step / steps) });
      }
    }
    this.endpoint = { ...point };
    this.cachedPoints = null;
    this.revision++;
  }

  private add(point: Point): void {
    for (const cell of brushFootprint(point, this.tool, this.brush, this.size)) this.cells.set(cell.z * this.size + cell.x, cell);
  }
}

/** Only the initiating primary pointer may finish an interaction. Cancellation consumes it. */
export class PointerInteraction {
  private owner: number | null = null;
  get pointerId(): number | null { return this.owner; }
  get active(): boolean { return this.owner !== null; }
  owns(pointerId: number): boolean { return this.owner === pointerId; }

  begin(pointerId: number, button: number): boolean {
    if (button !== 0 || this.active) return false;
    this.owner = pointerId;
    return true;
  }

  movement(pointerId: number, buttons: number): 'ignore' | 'continue' | 'cancel' {
    if (!this.owns(pointerId)) return 'ignore';
    return (buttons & 1) !== 0 && (buttons & 2) === 0 ? 'continue' : 'cancel';
  }

  release(pointerId: number, button: number, allowed: boolean): 'ignore' | 'commit' | 'cancel' {
    if (!this.owns(pointerId) || button !== 0) return 'ignore';
    this.owner = null;
    return allowed ? 'commit' : 'cancel';
  }

  cancel(): number | null {
    const pointerId = this.owner;
    this.owner = null;
    return pointerId;
  }
}
