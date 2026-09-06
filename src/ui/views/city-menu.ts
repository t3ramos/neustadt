import type { CityState } from '../../domain/types';
import { tr, getLocale, formatNumber as fmt } from '../../i18n/index';
import { icon, escape } from '../dom';
import { calendarDate } from '../../simulation/calendar';
import { MAX_NEW_CITY_SIZE, nextCitySize } from '../../world/scenarios';
import { version as appVersion } from '../../../package.json';

export function renderCityMenuView(
  state: CityState,
  recoveryRaw: string | null,
  tickAccumulator: number,
) {
  return ` ${
    recoveryRaw
      ? `<div class="storage-warning">${tr('Der nicht lesbare Originalspielstand wird nicht überschrieben.', 'The unreadable original save will not be overwritten.')} <button id="download-recovery" class="text-link">${tr('Originaldatei sichern', 'Back up original file')}</button>
    </div>`
      : ''
  }<div class="menu-city">
    <img src="${import.meta.env.BASE_URL}assets/neustadt-cover.png" alt="${tr('Neustadt Küstenstadt', 'Neustadt coastal city')}"/>
    <div>
    <strong>${escape(state.name)}</strong>
    <span>${fmt(state.stats.population)} ${tr('Einwohner', 'residents')} · ${calendarDate(state.month, tickAccumulator, getLocale())}</span>
    </div>
    </div>
    <label class="form-label">${tr('Stadtname', 'City name')}<div class="rename-row">
    <input id="rename-input" value="${escape(state.name)}" maxlength="40"/>
    <button class="button secondary" id="rename-btn">${tr('Ändern', 'Rename')}</button>
    </div>
    </label>
    <div class="menu-grid">${[
      [
        'menu-save',
        'save',
        tr('Stadt speichern', 'Save city'),
        tr('Lokal in diesem Browser', 'Locally in this browser'),
      ],
      [
        'menu-export',
        'download',
        tr('Spielstand exportieren', 'Export save'),
        tr('Als JSON-Datei sichern', 'Save as a JSON file'),
      ],
      [
        'menu-import',
        'upload',
        tr('Spielstand importieren', 'Import save'),
        tr('Gesicherte Stadt fortsetzen', 'Continue a saved city'),
      ],
      [
        'menu-new',
        'sprout',
        tr('Neue Stadt', 'New city'),
        tr('Eine neue Geschichte beginnen', 'Begin a new story'),
      ],
      ...(state.size < MAX_NEW_CITY_SIZE
        ? [
            [
              'menu-expand',
              'scan',
              tr('Region erweitern', 'Expand region'),
              `${state.size} × ${state.size} → ${nextCitySize(state.size)} × ${nextCitySize(state.size)}`,
            ],
          ]
        : []),
      [
        'menu-photo',
        'camera',
        tr('Stadt fotografieren', 'Take a photo'),
        tr('Deine Perspektive als PNG', 'Export your view as a PNG'),
      ],
    ]
      .map(
        ([id, ic, title, sub]) => `<button id="${id}">${icon(ic)}<span>
    <strong>${title}</strong>
    <small>${sub}</small>
    </span>${icon('chevron-right')}</button>`,
      )
      .join('')}</div>
    <div class="menu-footer">
    <span>${tr('NEUSTADT · REGIONEN & STADTLEBEN', 'NEUSTADT · REGIONS & CITY LIFE')} · v${appVersion}</span>
    <button id="menu-help" class="text-link">${tr('Spielanleitung', 'How to play')} ${icon('arrow-up-right')}</button>
    </div>
    <div class="easter-egg-action">
    <button id="menu-easter-egg" class="text-link">Easter Egg</button>
    </div>`;
}
