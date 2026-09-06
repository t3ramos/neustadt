import { ZONE_DENSITIES, effectiveZoneDensity } from '../buildings/density';
import { EASTER_EGG_BUILDING_VARIATION } from '../buildings/lots';
/** Read-only build planning and atomic execution of the resulting changes. */
import type {
  BuildOptions,
  BuildPreview,
  BuildResult,
  CityState,
  Point,
  TileKind,
  Tool,
} from '../domain/types';
import { formatNumber, tr } from '../i18n/index';
import { MAX_ELEVATION, MIN_ELEVATION, TERRAIN_STEP } from '../world/terrain';
import { TOOL_DEFS } from './catalog';
import {
  dimensions,
  getFootprint,
  inBounds,
  isBuilding,
  isZone,
  point,
  rootTile,
  tileAt,
} from './city-queries';
import { recalculate } from './economy';
import { result } from './events';
import { OFFSETS } from './networks';
import { isToolUnlocked, recordBuild, updateProgression } from './progression';
import { clearTile, placeFacility } from './tile-operations';

interface PlannedChange {
  points: Point[];
  cost: number;
  elevation?: number;
  rezone?: boolean;
}

interface BuildPlan extends BuildPreview {
  changes: PlannedChange[];
  rotation: 0 | 1 | 2 | 3;
}

function buildUnit(tool: Tool, count: number): string {
  return TOOL_DEFS[tool]?.footprint
    ? tr('Gebäude', count === 1 ? 'building' : 'buildings')
    : tr(count === 1 ? 'Feld' : 'Felder', count === 1 ? 'tile' : 'tiles');
}

function planBuild(
  state: CityState,
  points: Point[],
  tool: Tool,
  options: BuildOptions = {},
): BuildPlan {
  const rotation = options.rotation ?? 0;
  const out: BuildPlan = {
    cost: 0,
    valid: [],
    invalid: [],
    message: tr('Hier ist kein Bau möglich.', 'You cannot build here.'),
    count: 0,
    changes: [],
    rotation,
  };
  if (options.density !== undefined && !ZONE_DENSITIES.includes(options.density)) {
    out.message = tr('Ungültige Bebauungsdichte.', 'Invalid zoning density.');
    return out;
  }
  if (![0, 1, 2, 3].includes(rotation)) {
    out.message = tr('Ungültige Ausrichtung.', 'Invalid orientation.');
    return out;
  }
  if (tool === 'inspect' || tool === 'pan' || (tool !== 'bulldoze' && !TOOL_DEFS[tool])) {
    out.message = tr('Wähle ein Bauwerkzeug.', 'Select a construction tool.');
    return out;
  }
  if (!isToolUnlocked(state, tool)) {
    out.message = tr(
      'Dieses Bauwerk wird durch den Stadtaufstieg freigeschaltet.',
      'This building is unlocked by city progression.',
    );
    out.invalid = points.map(point);
    return out;
  }
  const terrain = ['raise', 'lower', 'level'].includes(tool);
  const seen = new Set<number>();
  const reject = (p: Point, message: string) => {
    out.invalid.push(point(p));
    out.message = message;
  };
  const add = (change: PlannedChange) => {
    out.changes.push(change);
    out.valid.push(...change.points);
    out.cost += change.cost;
    out.count += change.rezone ? change.points.length : 1;
  };
  const target =
    options.targetElevation ??
    (points[0] ? tileAt(state, points[0].x, points[0].z)?.elevation : undefined);
  if (
    tool === 'level' &&
    (target === undefined ||
      !Number.isFinite(target) ||
      target < MIN_ELEVATION ||
      target > MAX_ELEVATION ||
      Math.abs(target / TERRAIN_STEP - Math.round(target / TERRAIN_STEP)) > 0.001)
  ) {
    out.message = tr(
      'Wähle eine gültige Geländehöhe in 5-Meter-Schritten.',
      'Choose a valid terrain height in 5-meter steps.',
    );
    out.invalid = points.map(point);
    return out;
  }
  if (TOOL_DEFS[tool]?.footprint) {
    const p = points[0];
    if (!p) return out;
    const [w, d] = dimensions(tool, rotation);
    const members: Point[] = [];
    const base = tileAt(state, p.x, p.z)?.elevation;
    for (let z = p.z; z < p.z + d; z++)
      for (let x = p.x; x < p.x + w; x++) {
        const p2 = { x, z };
        members.push(p2);
        const t = tileAt(state, x, z);
        if (!t)
          reject(
            p2,
            tr(
              'Das gesamte Gebäude muss innerhalb der Karte liegen.',
              'The entire building must fit inside the map.',
            ),
          );
        else if (t.elevation < 0)
          reject(
            p2,
            tr(
              'Das Gebäude benötigt eine vollständig trockene Grundfläche.',
              'The building needs a completely dry footprint.',
            ),
          );
        else if (!['empty', 'tree', 'rubble'].includes(t.kind))
          reject(
            p2,
            tr(
              'Das gesamte Baufeld muss frei sein. Reiße die Bebauung zuerst ab.',
              'The entire site must be clear. Demolish existing buildings first.',
            ),
          );
        else if (Math.abs(t.elevation - (base ?? 0)) > 0.001)
          reject(
            p2,
            tr(
              'Ebne die gesamte Grundfläche vor dem Bau ein.',
              'Level the entire footprint before building.',
            ),
          );
      }
    if (!out.invalid.length && tool === 'seaport') {
      const edge: Point[] = [];
      if (rotation === 0) for (let x = p.x; x < p.x + w; x++) edge.push({ x, z: p.z + d });
      if (rotation === 1) for (let z = p.z; z < p.z + d; z++) edge.push({ x: p.x - 1, z });
      if (rotation === 2) for (let x = p.x; x < p.x + w; x++) edge.push({ x, z: p.z - 1 });
      if (rotation === 3) for (let z = p.z; z < p.z + d; z++) edge.push({ x: p.x + w, z });
      if (edge.filter((e) => (tileAt(state, e.x, e.z)?.elevation ?? 0) < 0).length < 2) {
        out.invalid = members;
        out.message = tr(
          'Die Kaimauer muss mit mindestens zwei Feldern direkt ans Wasser grenzen. Drehe den Hafen mit R.',
          'At least two quay tiles must directly border water. Rotate the seaport with R.',
        );
      }
    }
    if (out.invalid.length) {
      out.valid = members.filter((p) => !out.invalid.some((i) => i.x === p.x && i.z === p.z));
      return out;
    }
    add({
      points: members,
      cost:
        TOOL_DEFS[tool]!.cost +
        members.reduce((sum, p) => sum + (tileAt(state, p.x, p.z)!.kind === 'tree' ? 2 : 0), 0),
    });
  } else
    for (const p of points) {
      if (!inBounds(state, p.x, p.z)) {
        reject(p, tr('Außerhalb des Stadtgebiets.', 'Outside the city limits.'));
        continue;
      }
      const t = tileAt(state, p.x, p.z)!;
      const id = p.z * state.size + p.x;
      if (seen.has(id)) continue;
      seen.add(id);
      if (tool === 'bulldoze') {
        const root = rootTile(state, t);
        const rootId = root.z * state.size + root.x;
        if (rootId !== id && seen.has(rootId)) continue;
        seen.add(rootId);
        if (['empty', 'water'].includes(t.kind) && !t.hasPipe && !t.hasPowerLine) {
          reject(p, tr('Hier gibt es nichts abzureißen.', 'There is nothing to demolish here.'));
          continue;
        }
        const members = getFootprint(state, t);
        for (const m of members) seen.add(m.z * state.size + m.x);
        add({ points: members, cost: t.kind === 'tree' ? 2 : isBuilding(t.kind) ? 25 : 5 });
        continue;
      }
      if (tool === 'pipe' || tool === 'powerline') {
        if (tool === 'pipe' ? t.hasPipe : t.hasPowerLine) {
          reject(
            p,
            tr('Diese Leitung ist bereits vorhanden.', 'This utility line already exists.'),
          );
          continue;
        }
        add({ points: [point(p)], cost: TOOL_DEFS[tool]!.cost + (t.elevation < 0 ? 12 : 0) });
        continue;
      }
      if (terrain) {
        if (!['empty', 'tree', 'water'].includes(t.kind)) {
          reject(
            p,
            tr(
              'Gelände unter Bebauung kann nicht verändert werden.',
              'Terrain beneath buildings cannot be changed.',
            ),
          );
          continue;
        }
        const elevation =
          tool === 'level'
            ? target!
            : t.elevation + (tool === 'raise' ? TERRAIN_STEP : -TERRAIN_STEP);
        if (elevation < MIN_ELEVATION || elevation > MAX_ELEVATION) {
          reject(
            p,
            tr(
              'Die maximale Geländehöhe oder Wassertiefe ist erreicht.',
              'The maximum terrain height or water depth has been reached.',
            ),
          );
          continue;
        }
        if (Math.abs(elevation - t.elevation) < 0.001) {
          reject(
            p,
            tr(
              'Dieses Feld hat bereits die Zielhöhe.',
              'This tile is already at the target height.',
            ),
          );
          continue;
        }
        add({
          points: [point(p)],
          cost:
            Math.round(Math.abs(elevation - t.elevation) / TERRAIN_STEP) * TOOL_DEFS[tool]!.cost,
          elevation,
        });
        continue;
      }
      if (
        tool === 'beach' &&
        (t.elevation < 0 ||
          t.kind === 'water' ||
          !OFFSETS.some(([dx, dz]) => tileAt(state, t.x + dx, t.z + dz)?.kind === 'water'))
      ) {
        reject(
          p,
          tr(
            'Ein Strand braucht ein trockenes Feld direkt am Wasser.',
            'A beach requires a dry tile directly beside water.',
          ),
        );
        continue;
      }
      if (
        isZone(tool as TileKind) &&
        t.kind === tool &&
        effectiveZoneDensity(t) !== (options.density ?? 'high')
      ) {
        const members = getFootprint(state, t);
        for (const m of members) seen.add(m.z * state.size + m.x);
        add({ points: members, cost: TOOL_DEFS[tool]!.cost * members.length, rezone: true });
        continue;
      }
      if (t.kind === tool) {
        reject(p, tr('Dieses Grundstück ist bereits bebaut.', 'This lot is already developed.'));
        continue;
      }
      if (t.elevation < 0 && tool !== 'road' && tool !== 'rail') {
        reject(
          p,
          tr(
            'Hier ist Wasser. Baue an Land oder errichte eine Brücke.',
            'This is water. Build on land or construct a bridge.',
          ),
        );
        continue;
      }
      if (!['empty', 'tree', 'rubble', 'water'].includes(t.kind)) {
        reject(
          p,
          tr('Reiße die vorhandene Bebauung zuerst ab.', 'Demolish the existing structures first.'),
        );
        continue;
      }
      add({
        points: [point(p)],
        cost: TOOL_DEFS[tool]!.cost + (t.elevation < 0 ? 90 : t.kind === 'tree' ? 2 : 0),
      });
    }
  if (out.count) {
    out.message =
      state.money < out.cost
        ? tr(
            `Nicht genügend Geld. Benötigt: ${formatNumber(out.cost)} €.`,
            `Not enough money. Required: €${formatNumber(out.cost)}.`,
          )
        : `${formatNumber(out.count)} ${buildUnit(tool, out.count)} · ${formatNumber(out.cost)} €${out.invalid.length ? tr(` · ${formatNumber(out.invalid.length)} Felder nicht bebaubar`, ` · ${formatNumber(out.invalid.length)} tiles cannot be built on`) : ''}`;
  }
  if (out.changes.some((change) => change.rezone) && state.money >= out.cost)
    out.message += tr(
      ' · Dichte ändern: betroffene Gebäude werden vollständig neu entwickelt (Stufe 0).',
      ' · Change density: affected buildings redevelop across their entire footprint (level 0).',
    );
  return out;
}

export function previewBuild(
  state: CityState,
  points: Point[],
  tool: Tool,
  options: BuildOptions = {},
): BuildPreview {
  const {
    changes: _changes,
    rotation: _rotation,
    ...preview
  } = planBuild(state, points, tool, options);
  return preview;
}

export function build(
  state: CityState,
  points: Point[],
  tool: Tool,
  options: BuildOptions = {},
): BuildResult {
  const plan = planBuild(state, points, tool, options);
  if (!plan.count || plan.cost > state.money) return result(false, plan.message, plan.cost);
  for (const change of plan.changes) {
    if (TOOL_DEFS[tool]?.footprint) {
      placeFacility(state, change.points[0], tool as TileKind, plan.rotation);
      continue;
    }
    for (const p of change.points) {
      const t = tileAt(state, p.x, p.z)!;
      if (tool === 'bulldoze') clearTile(t, true);
      else if (tool === 'pipe') t.hasPipe = true;
      else if (tool === 'powerline') t.hasPowerLine = true;
      else if (change.elevation !== undefined) {
        t.elevation = change.elevation;
        if (t.elevation < 0) t.kind = 'water';
        else if (t.kind === 'water') t.kind = 'empty';
      } else {
        t.kind = tool as TileKind;
        t.level = 0;
        t.age = 0;
        t.fire = 0;
        t.anchor = -1;
        t.rotation = 0;
        delete t.lotWidth;
        delete t.lotDepth;
        delete t.ruralCommercial;
        if (isZone(tool as TileKind)) t.zoneDensity = options.density ?? 'high';
        else delete t.zoneDensity;
        if (t.variation === EASTER_EGG_BUILDING_VARIATION)
          t.variation = (t.x * 37 + t.z * 71) % 1000;
      }
    }
  }
  state.money -= plan.cost;
  recalculate(state);
  recordBuild(state, tool, plan.count);
  updateProgression(state);
  const label =
    tool === 'bulldoze'
      ? tr('abgerissen', 'demolished')
      : ['raise', 'lower', 'level'].includes(tool)
        ? tr('bearbeitet', 'modified')
        : tr('gebaut', 'built');
  return result(
    true,
    `${formatNumber(plan.count)} ${buildUnit(tool, plan.count)} ${label} · ${formatNumber(plan.cost)} €`,
    plan.cost,
    plan.count,
  );
}
