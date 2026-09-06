import type { CityState, Tool, ZoneDensity } from '../domain/types';
import { TOOL_DEFS } from '../simulation/city-simulation';
import { isToolUnlocked } from '../simulation/progression';
import { tr, formatCurrency as euro } from '../i18n/index';
import { $, icon, escape, refreshIcons } from './dom';
import { captureFocus, restoreFocus } from './focus';
import { toolMetadata } from './tool-metadata';
import { densityLabel, isZoneTool } from './density-picker';
const GROUP_TOOLS: Record<string, Tool[]> = {
  favorites: [
    'inspect',
    'pan',
    'road',
    'residential',
    'commercial',
    'industrial',
    'park',
    'bulldoze',
    'citizen',
  ],
  zones: ['residential', 'commercial', 'industrial'],
  transport: ['road', 'rail'],
  utilities: ['power', 'waterpump', 'powerline', 'pipe', 'wind', 'solar'],
  services: ['police', 'fire', 'hospital', 'school', 'university', 'recycling'],
  nature: ['park', 'tree', 'beach', 'bulldoze'],
  terrain: ['raise', 'lower', 'level'],
  special: ['stadium', 'airport', 'seaport'],
};

export function renderToolPalette(
  state: CityState,
  category: string,
  tool: Tool,
  onSelect: (tool: Tool, event: MouseEvent) => void,
  density?: ZoneDensity,
) {
  const focus = $('#tool-list').contains(document.activeElement) ? captureFocus() : null;
  $('#tool-list').innerHTML = GROUP_TOOLS[category]
    .map((t) => {
      const meta = toolMetadata()[t],
        def = TOOL_DEFS[t],
        locked = !isToolUnlocked(state, t),
        dims = def?.footprint;
      return `<button class="build-tool ${tool === t ? 'selected' : ''} ${t} ${locked ? 'locked' : ''}" data-tool="${t}" ${isZoneTool(t) ? 'aria-controls="density-picker" aria-expanded="false"' : ''} title="${escape(def?.description ?? (t === 'pan' ? tr('Mit links ziehen oder WASD verwenden.', 'Drag with the left mouse button or use WASD.') : t === 'citizen' ? tr('Bewohner greifen, heben und wieder absetzen.', 'Pick up residents, lift them and set them down.') : tr('Gebäude auswählen und Informationen anzeigen', 'Select buildings and view their details')))}" aria-pressed="${tool === t}">
    <span class="tool-icon">${icon(meta.icon)}</span>
    <span class="tool-name">${meta.label}</span>${tool === t && density ? `<span class="density-badge">${densityLabel(density)}</span>` : ''}
    <small>${['inspect', 'pan', 'citizen'].includes(t) ? (t === 'pan' ? tr('M · Ziehen', 'M · Drag') : t === 'citizen' ? tr('C · Greifen', 'C · Grab') : tr('Erkunden', 'Explore')) : t === 'bulldoze' ? tr('2–25 €', '€2–25') : euro(def?.cost ?? 0)}</small>${dims ? `<span class="footprint-badge">${dims[0]}×${dims[1]}</span>` : ''}${locked ? `<span class="tool-lock">${icon('lock-keyhole')}</span>` : tool === t ? '<span class="selected-indicator"></span>' : ''}</button>`;
    })
    .join('');
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(
    (b) =>
      (b.onclick = (event) => {
        onSelect(b.dataset.tool as Tool, event);
      }),
  );
  const def = TOOL_DEFS[tool];
  const zoning = ['residential', 'commercial', 'industrial'].includes(tool);
  const network = ['road', 'rail', 'pipe', 'powerline'].includes(tool);
  const desc = zoning
    ? tr(
        'Rechteck aufziehen · loslassen zum Bauen · Rechtsklick / Esc: abbrechen.',
        'Drag a rectangle · release to build · Right-click / Esc: cancel.',
      )
    : network
      ? tr(
          'Linie ziehen · loslassen zum Bauen · Rechtsklick / Esc: abbrechen.',
          'Drag a line · release to build · Right-click / Esc: cancel.',
        )
      : tool === 'inspect'
        ? tr('Klicke auf ein Gebäude, um mehr zu erfahren.', 'Click a building to learn more.')
        : tool === 'pan'
          ? tr(
              'Links ziehen oder WASD · rechts drehen · Mausrad zoomen.',
              'Left-drag or WASD to move · right-drag to rotate · mouse wheel to zoom.',
            )
          : tool === 'citizen'
            ? tr(
                'Figur greifen und ziehen · sanft absetzen zum Weiterlaufen · schneller Wurf hat Folgen.',
                'Grab and drag a resident · set them down gently to let them walk · a hard throw has consequences.',
              )
            : tool === 'level'
              ? tr(
                  'Erster Klick bestimmt die Zielhöhe. Zum Glätten über freie Flächen ziehen.',
                  'The first click sets the target height. Drag across open ground to level it.',
                )
              : tool === 'bulldoze'
                ? tr(
                    'Klicken oder ziehen. Große Gebäude werden vollständig abgerissen.',
                    'Click or drag. Large buildings are demolished as a whole.',
                  )
                : (def?.description ??
                  tr('Klicken oder ziehen, um zu bauen.', 'Click or drag to build.'));
  $('#tool-hint').innerHTML = `<span class="hint-dot" style="background:${def?.color ?? '#8aa89b'}">
    </span>
    <strong>${toolMetadata()[tool]?.label ?? tool}</strong>
    <span>${escape(desc)}</span>`;
  $('#brush-control').style.display =
    def?.footprint ||
    zoning ||
    ['inspect', 'pan', 'citizen', 'road', 'rail', 'pipe', 'powerline'].includes(tool)
      ? 'none'
      : 'flex';
  $('#rotate-building').classList.toggle('hidden', !def?.footprint);
  refreshIcons($('#tool-list'));
  restoreFocus(focus, $('#tool-list'));
  $('#tool-hint').title = desc;
}
