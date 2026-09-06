import type { CityState, Tile } from '../../domain/types';
import { TOOL_DEFS, getFootprint } from '../../simulation/city-simulation';
import { isEasterEggBuilding } from '../../rendering/buildings/easter-egg';
import { toolMetadata } from '../tool-metadata';
import { tr, formatNumber as fmt } from '../../i18n/index';
import { icon, escape } from '../dom';
import { densityLabel, isZoneTool } from '../density-picker';
import { effectiveZoneDensity } from '../../buildings/density';

export function renderInspectorView(state: CityState, t: Tile) {
  const def = TOOL_DEFS[t.kind],
    m = toolMetadata()[t.kind],
    cells = getFootprint(state, t);
  const dims = def?.footprint;
  const pop = t.kind === 'residential' ? [0, 12, 28, 52, 88][t.level] * cells.length : 0;
  return `<div class="panel-kicker">
    <span>${tr('GRUNDSTÜCK', 'PLOT')} ${t.x + 1} · ${t.z + 1}</span>
    <button id="inspector-close" class="small-icon" title="${tr('Details schließen', 'Close details')}">${icon('x')}</button>
    </div>
    <div class="inspector-icon ${t.kind}">${icon(m?.icon ?? (t.kind === 'water' ? 'waves' : 'sprout'))}</div>
    <h2>${isEasterEggBuilding(t) ? tr('Easter Egg · Bürogebäude', 'Easter Egg · Offices') : (m?.label ?? (t.kind === 'empty' ? tr('Freies Bauland', 'Open land') : t.kind === 'water' ? tr('Küstengewässer', 'Coastal water') : t.kind === 'rubble' ? tr('Trümmerfeld', 'Rubble') : t.kind))}</h2>
    <p>${escape(isEasterEggBuilding(t) ? tr('Ein besonderer Bürostandort. Dieses Firmengebäude gibt es nur einmal in deiner Stadt.', 'A distinctive business address. These company offices appear only once in your city.') : (def?.description ?? tr('Ein Stück deiner Region voller Möglichkeiten.', 'A corner of your region full of possibilities.')))}</p>
    <div class="inspector-tags">
    <span>${t.lotWidth ? `${t.lotWidth} × ${t.lotDepth} ${tr('Felder', 'tiles')} · ${tr('Stufe', 'Level')} ${t.level}` : dims ? `${dims[t.rotation % 2 ? 1 : 0]} × ${dims[t.rotation % 2 ? 0 : 1]} ${tr('Felder', 'tiles')}` : t.level > 0 ? tr(`Gebäudestufe ${t.level}`, `Building level ${t.level}`) : t.kind === 'road' || t.kind === 'rail' ? tr('Verkehrsfläche', 'Transport') : tr('Unbebaut', 'Undeveloped')}</span>
    <span>${tr(`${fmt(t.elevation * 10)} m Höhe`, `${fmt(t.elevation * 10)} m elevation`)}</span>${t.fire > 0 ? `<span class="danger">${tr('Brand!', 'Fire!')}</span>` : ''}</div>
    <div class="inspector-rows">${[
      [
        tr('Straßenanschluss', 'Road access'),
        t.connected ? tr('Angeschlossen', 'Connected') : tr('Kein Anschluss', 'Disconnected'),
      ],
      [
        tr('Stromversorgung', 'Power supply'),
        t.powered ? tr('Versorgt', 'Supplied') : tr('Nicht versorgt', 'Not supplied'),
      ],
      [
        tr('Wasserversorgung', 'Water supply'),
        t.watered ? tr('Versorgt', 'Supplied') : tr('Nicht versorgt', 'Not supplied'),
      ],
      [
        tr('Wasserrohr', 'Water pipe'),
        cells.some((p) => state.tiles[p.z * state.size + p.x].hasPipe)
          ? tr('Vorhanden', 'Present')
          : tr('Keines', 'None'),
      ],
      [
        tr('Stromleitung', 'Power line'),
        cells.some((p) => state.tiles[p.z * state.size + p.x].hasPowerLine)
          ? tr('Vorhanden', 'Present')
          : tr('Keine', 'None'),
      ],
      ...(isZoneTool(t.kind)
        ? [[tr('Bebauungsdichte', 'Zoning density'), densityLabel(effectiveZoneDensity(t))]]
        : []),
      [tr('Grundstückswert', 'Land value'), `${fmt(t.landValue)} / 100`],
      [tr('Umweltbelastung', 'Pollution'), `${fmt(t.pollution)} %`],
      ...(pop ? [[tr('Wohnplätze', 'Residential capacity'), fmt(pop)]] : []),
    ]
      .map(
        ([a, b]) => `<div>
    <span>${a}</span>
    <strong>${b}</strong>
    </div>`,
      )
      .join(
        '',
      )}</div>${!['empty', 'water'].includes(t.kind) || t.hasPipe || t.hasPowerLine ? `<button id="demolish-selected" class="button secondary">${icon('pickaxe')} ${dims || t.lotWidth ? tr('Gesamtes Gebäude abreißen', 'Demolish entire building') : tr('Grundstück abreißen', 'Clear plot')}</button>` : ''}`;
}
