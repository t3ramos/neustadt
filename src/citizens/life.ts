import type { CityState } from '../domain/types';
import type { PedestrianEdge, PedestrianGraph } from './routing';
import type {
  CitizenEventKind,
  CitizenEventResult,
  CitizenLifeEvent,
  CitizenLifeSnapshot,
} from '../domain/citizen-life';
export type {
  CitizenEventKind,
  CitizenEventResult,
  CitizenEventRequest,
  CitizenLifeEvent,
  CitizenLifeSnapshot,
} from '../domain/citizen-life';

export type CitizenActivity =
  | 'strolling'
  | 'to-work'
  | 'working'
  | 'to-park'
  | 'leisure'
  | 'to-home'
  | 'home'
  | 'to-event'
  | 'socialising';
type Purpose = 'work' | 'park' | 'home';
export interface CitizenLifeStep {
  edge?: PedestrianEdge;
  waiting: boolean;
  activity: CitizenActivity;
  destination?: number;
}
export interface CitizenLifeActor {
  id: number;
  node: number;
  x: number;
  z: number;
}
interface Field {
  distance: Map<number, number>;
  root: Map<number, number>;
  next: Map<number, PedestrianEdge>;
}
interface Actor {
  phase: Purpose;
  status: CitizenLifeStep;
  until?: number;
  done: boolean;
  turns: number;
  previous?: number;
  lastNode?: number;
}
interface Invitation {
  target: number;
  path: number[];
  spreading: boolean;
  arrived: boolean;
}
const MAX_ACTORS = 720;
const RADIUS = 8;
const CAP = 18;
const SOCIAL_RADIUS = 0.6;
const MAX_SITE_ATTEMPTS = 8;
// At the actual pedestrian pace, crossing a neighbourhood takes 30–60 seconds.
const duration = { gathering: 90, festival: 150 };
const dwell = { work: 30, park: 12, home: 24 };
const travel: Record<Purpose, CitizenActivity> = {
  work: 'to-work',
  park: 'to-park',
  home: 'to-home',
};
const arrived: Record<Purpose, CitizenActivity> = {
  work: 'working',
  park: 'leisure',
  home: 'home',
};

/** Pure visual director: never writes CityState. Graphs are immutable snapshots;
 * call update with a NEW graph after topology, building or active-node changes.
 * activeNodeIds restricts both travel and destinations, not just actor spawns.
 * Call step only at a fully reached node, including each frame while waiting.
 * Never call step halfway across an edge: crosswalks must finish before dwelling.
 * advance uses seconds and a 0..24 hour; walking=false freezes all life clocks.
 * Cost: three O(V+E) fields per rebuild, at most eight per event request;
 * step is O(node degree), with at most 720 retained actors and 18 invitations.
 */
export function createCitizenLife() {
  let graph: PedestrianGraph | undefined;
  let allowed = new Set<number>();
  let fields = {} as Record<Purpose, Field>;
  let sites: number[] = [];
  let parkNodes = new Set<number>();
  let clock = 0,
    hour = 12,
    cooldownUntil = 0,
    builds = 0;
  let event:
    | {
        kind: CitizenEventKind;
        site: number;
        expires: number;
        field: Field;
        invitations: Map<number, Invitation>;
        invited: number;
      }
    | undefined;
  const actors = new Map<number, Actor>();
  const phase = (): Purpose =>
    hour >= 7 && hour < 16 ? 'work' : hour >= 16 && hour < 20 ? 'park' : 'home';
  const idle = (): CitizenLifeStep => ({ waiting: false, activity: 'strolling' });
  function field(seeds: number[]): Field {
    builds++;
    const result: Field = { distance: new Map(), root: new Map(), next: new Map() };
    // Reverse adjacency also supports directed test/custom graphs correctly.
    const reverse = new Map<number, { from: number; edge: PedestrianEdge }[]>();
    for (const id of allowed)
      for (const edge of graph!.neighbors(id)) {
        if (!allowed.has(edge.node)) continue;
        const list = reverse.get(edge.node) ?? [];
        list.push({ from: id, edge });
        reverse.set(edge.node, list);
      }
    const queue = [...new Set(seeds)].sort((a, b) => a - b);
    for (const id of queue) {
      result.distance.set(id, 0);
      result.root.set(id, id);
    }
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      for (const { from, edge } of reverse.get(id) ?? []) {
        if (result.distance.has(from)) continue;
        result.distance.set(from, result.distance.get(id)! + 1);
        result.root.set(from, result.root.get(id)!);
        result.next.set(from, edge);
        queue.push(from);
      }
    }
    return result;
  }
  function update(
    state: CityState,
    nextGraph: PedestrianGraph,
    activeNodeIds?: ReadonlySet<number> | readonly number[],
  ) {
    if (graph === nextGraph) return;
    graph = nextGraph;
    allowed = new Set(activeNodeIds ?? graph.nodes.map((n) => n.id));
    for (const id of allowed) if (!graph.byId.has(id)) allowed.delete(id);
    const seeds: Record<Purpose, number[]> = { work: [], park: [], home: [] };
    const origin = 0.5 - state.size / 2;
    for (const id of allowed) {
      const node = graph.byId.get(id)!;
      const tile = state.tiles[node.tile];
      if (!tile || tile.fire > 0) continue;
      if (tile.kind === 'park') seeds.park.push(id);
      if (tile.kind !== 'road') continue;
      // Use the pavement on the actual building side, not the opposite kerb.
      for (const [dx, dz] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const x = tile.x + dx,
          z = tile.z + dz;
        if (x < 0 || z < 0 || x >= state.size || z >= state.size) continue;
        const neighbor = state.tiles[z * state.size + x];
        if (!neighbor || neighbor.fire > 0 || neighbor.level <= 0) continue;
        if ((node.x - tile.x - origin) * dx + (node.z - tile.z - origin) * dz < 0.3) continue;
        if (neighbor.kind === 'residential') seeds.home.push(id);
        if (neighbor.kind === 'commercial' || neighbor.kind === 'industrial') seeds.work.push(id);
      }
    }
    sites = [...new Set(seeds.park)].sort((a, b) => a - b);
    parkNodes = new Set(sites);
    fields = { work: field(seeds.work), park: field(seeds.park), home: field(seeds.home) };
    actors.clear();
    event = undefined;
  }
  function advance(dt: number, walking: boolean, nextHour: number) {
    if (!walking) return;
    if (Number.isFinite(dt) && dt > 0) clock += dt;
    if (Number.isFinite(nextHour)) hour = ((nextHour % 24) + 24) % 24;
    if (event && clock >= event.expires) {
      event = undefined;
      for (const actor of actors.values()) {
        if (actor.status.activity === 'socialising' || actor.status.activity === 'to-event') {
          actor.status = idle();
        }
      }
    }
    for (const actor of actors.values())
      if (actor.phase !== phase()) {
        actor.phase = phase();
        actor.until = undefined;
        actor.done = false;
        if (actor.status.activity !== 'socialising' && actor.status.activity !== 'to-event')
          actor.status = idle();
      }
  }
  function step(actorId: number, currentNode: number): CitizenLifeStep {
    if (!graph || !allowed.has(currentNode)) return idle();
    let actor = actors.get(actorId);
    if (!actor) {
      if (actors.size >= MAX_ACTORS) return idle();
      actor = { phase: phase(), status: idle(), done: false, turns: 0 };
      actors.set(actorId, actor);
    }
    if (actor.lastNode !== currentNode) {
      actor.previous = actor.lastNode;
      actor.lastNode = currentNode;
    }
    const save = (status: CitizenLifeStep) => {
      actor.status = status;
      return { ...status };
    };
    const invitation = event?.invitations.get(actorId);
    if (event && invitation) {
      let edge: PedestrianEdge | undefined;
      if (currentNode === invitation.target) {
        invitation.arrived = true;
        return save({ waiting: true, activity: 'socialising', destination: invitation.target });
      } else {
        invitation.arrived = false;
        if (currentNode === event.site) invitation.spreading = true;
        if (invitation.spreading) {
          const index = invitation.path.indexOf(currentNode);
          if (index >= 0)
            edge = graph.neighbors(currentNode).find((e) => e.node === invitation.path[index + 1]);
        } else edge = event.field.next.get(currentNode);
        if (edge)
          return save({
            edge,
            waiting: false,
            activity: 'to-event',
            destination: invitation.target,
          });
        event.invitations.delete(actorId);
      }
    }
    const destination = fields[actor.phase].root.get(currentNode);
    if (destination !== undefined && !actor.done) {
      const edge = fields[actor.phase].next.get(currentNode);
      if (edge) return save({ edge, waiting: false, activity: travel[actor.phase], destination });
      actor.until ??= clock + dwell[actor.phase];
      if (clock < actor.until)
        return save({ waiting: true, activity: arrived[actor.phase], destination });
      actor.done = true;
    }
    const neighbors = graph.neighbors(currentNode).filter((e) => allowed.has(e.node));
    const onward = neighbors.filter((e) => e.node !== actor.previous);
    const candidates = onward.length ? onward : neighbors;
    // Vary each junction visit independently: using the same modulo for a
    // crossing decision and edge index can permanently exclude one branch.
    const sample =
      Math.sin((actorId + 1) * 127.1 + currentNode * 311.7 + actor.turns++ * 74.7) * 43758.5453;
    const index = Math.floor((sample - Math.floor(sample)) * candidates.length);
    return save({ edge: candidates[index], waiting: false, activity: 'strolling' });
  }
  function trigger(
    kind: CitizenEventKind,
    near: { x: number; z: number },
    candidates: readonly CitizenLifeActor[],
    canHost?: (site: { kind: CitizenEventKind; x: number; z: number }) => boolean,
  ): CitizenEventResult {
    const fail = (
      reason: 'no-place' | 'no-people' | 'cooldown' | 'active',
    ): CitizenEventResult => ({ ok: false, reason });
    if (event) return fail('active');
    if (clock < cooldownUntil) return fail('cooldown');
    if (!graph) return fail('no-place');
    const local = sites.filter((id) => {
      const n = graph!.byId.get(id)!;
      return Math.hypot(n.x - near.x, n.z - near.z) <= RADIUS;
    });
    local.sort((a, b) => {
      const p = graph!.byId.get(a)!,
        q = graph!.byId.get(b)!;
      return (
        Math.hypot(p.x - near.x, p.z - near.z) - Math.hypot(q.x - near.x, q.z - near.z) || a - b
      );
    });
    if (!local.length) return fail('no-place');
    // One nearest entrance per park tile: a disconnected park cannot consume
    // all eight attempts just because its obstacle graph contains many nodes.
    const attemptedParks = new Set<number>();
    let rejectedSite = false;
    for (const site of local) {
      const center = graph.byId.get(site)!;
      if (attemptedParks.has(center.tile)) continue;
      if (attemptedParks.size === MAX_SITE_ATTEMPTS) break;
      attemptedParks.add(center.tile);
      const routes = field([site]);
      const nearby = candidates
        .slice(0, MAX_ACTORS)
        .filter(
          (a) =>
            Number.isFinite(a.id) &&
            allowed.has(a.node) &&
            routes.distance.has(a.node) &&
            Math.hypot(a.x - center.x, a.z - center.z) <= RADIUS,
        );
      if (!nearby.length) continue;
      nearby.sort(
        (a, b) =>
          Math.hypot(a.x - center.x, a.z - center.z) - Math.hypot(b.x - center.x, b.z - center.z) ||
          a.id - b.id,
      );
      // Outward paths share the event tree. Both targets and the entire short
      // social branch stay on contiguous park paths, never on a road/crosswalk.
      const targets: { id: number; path: number[] }[] = [];
      for (const id of sites) {
        const n = graph.byId.get(id)!;
        if (
          Math.hypot(n.x - center.x, n.z - center.z) > SOCIAL_RADIUS ||
          (routes.distance.get(id) ?? Infinity) > 12
        )
          continue;
        const path = [id];
        while (path.at(-1) !== site) path.push(routes.next.get(path.at(-1)!)!.node);
        path.reverse();
        if (
          path.every(
            (node, i) =>
              parkNodes.has(node) &&
              Math.hypot(
                graph!.byId.get(node)!.x - center.x,
                graph!.byId.get(node)!.z - center.z,
              ) <= SOCIAL_RADIUS &&
              (i === 0 ||
                graph!.neighbors(path[i - 1]).some((e) => e.node === node && !e.crosswalk)),
          )
        )
          targets.push({ id, path });
      }
      const invitations = new Map<number, Invitation>();
      let unregistered = 0;
      for (const a of nearby) {
        if (invitations.has(a.id)) continue;
        if (!actors.has(a.id) && actors.size + unregistered >= MAX_ACTORS) continue;
        const target = targets[invitations.size % targets.length];
        invitations.set(a.id, {
          target: target.id,
          path: target.path,
          spreading: false,
          arrived: false,
        });
        if (!actors.has(a.id)) unregistered++;
        if (invitations.size === CAP) break;
      }
      if (!invitations.size) continue;
      // Validate the physical venue only after finding eligible local guests,
      // and before committing invitations or consuming the event cooldown.
      if (canHost && !canHost({ kind, x: center.x, z: center.z })) {
        rejectedSite = true;
        continue;
      }
      event = {
        kind,
        site,
        expires: clock + duration[kind],
        field: routes,
        invitations,
        invited: invitations.size,
      };
      cooldownUntil = event.expires + 20;
      return { ok: true, event: eventSnapshot()! };
    }
    return fail(rejectedSite ? 'no-place' : 'no-people');
  }
  function eventSnapshot(): CitizenLifeEvent | null {
    if (!event) return null;
    const node = graph!.byId.get(event.site)!;
    return {
      kind: event.kind,
      x: node.x,
      z: node.z,
      invited: event.invited,
      arrived: [...event.invitations.values()].filter((i) => i.arrived).length,
      remaining: Math.max(0, event.expires - clock),
    };
  }
  function stopEvent() {
    if (!event) return;
    event = undefined;
    cooldownUntil = clock + 20;
    for (const actor of actors.values())
      if (actor.status.activity === 'socialising' || actor.status.activity === 'to-event')
        actor.status = idle();
  }
  function getSnapshot(): CitizenLifeSnapshot {
    const counts = { work: 0, home: 0, leisure: 0, social: 0, wandering: 0 };
    for (const actor of actors.values()) {
      const a = actor.status.activity;
      if (a === 'working' || a === 'to-work') counts.work++;
      else if (a === 'home' || a === 'to-home') counts.home++;
      else if (a === 'leisure' || a === 'to-park') counts.leisure++;
      else if (event && (a === 'socialising' || a === 'to-event')) counts.social++;
      else counts.wandering++;
    }
    return {
      counts,
      event: eventSnapshot(),
      cooldownSeconds: Math.max(0, cooldownUntil - clock),
      total: actors.size,
    };
  }
  return {
    update,
    advance,
    step,
    trigger,
    stopEvent,
    getActorStatus: (id: number): CitizenLifeStep | undefined => {
      const a = actors.get(id);
      return a ? { ...a.status } : undefined;
    },
    getSnapshot,
    getDiagnostics: () => ({
      clock,
      hour,
      phase: phase(),
      actorCount: actors.size,
      fieldBuilds: builds,
    }),
    forget: (id: number) => {
      actors.delete(id);
      event?.invitations.delete(id);
    },
    reset: () => {
      graph = undefined;
      allowed.clear();
      sites = [];
      parkNodes.clear();
      actors.clear();
      event = undefined;
      clock = 0;
      hour = 12;
      cooldownUntil = 0;
      builds = 0;
    },
  };
}
