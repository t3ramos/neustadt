import type { CityState } from '../../domain/types';
import { tr } from '../../i18n/index';
import { icon } from '../dom';

export function renderDisasterView(state: CityState) {
  return `<label class="disaster-switch">
    <span>
    <strong>${tr('Katastrophenwerkzeuge aktivieren', 'Enable disaster tools')}</strong>
    <small>${tr('Experimentiermodus: Ereignisse absichtlich auslösen.', 'Sandbox mode: trigger events deliberately.')}</small>
    </span>
    <input id="disaster-enabled" type="checkbox" ${state.settings.disastersEnabled ? 'checked' : ''}/>
    </label>
    <p class="modal-note">${tr('Diese Ereignisse beschädigen Gebäude und können Strom- und Wassernetze unterbrechen. Nach dem Auslösen pausiert die Stadt, damit du die Wirkung ansehen oder mit Strg+Z rückgängig machen kannst. Nach dem Fortsetzen oder weiteren Stadtänderungen verfällt die Rücknahme.', 'These events damage buildings and may disrupt power and water networks. The city pauses after an event so you can inspect it or undo it with Ctrl+Z. Resuming simulation or making further city changes ends the undo window.')}</p>
    <div class="disaster-grid">${(
      [
        [
          'fire',
          'flame',
          tr('Großbrand', 'Major fire'),
          tr(
            'Feuer breitet sich aus. Versorgte Feuerwehren helfen.',
            'Fire spreads. Supplied fire stations help fight it.',
          ),
        ],
        [
          'earthquake',
          'activity',
          tr('Erdbeben', 'Earthquake'),
          tr('Gebäude und Straßen können einstürzen.', 'Buildings and roads may collapse.'),
        ],
        [
          'storm',
          'wind',
          tr('Schwerer Sturm', 'Severe storm'),
          tr(
            'Windschäden treffen Gebäude und Stromleitungen.',
            'High winds damage buildings and power lines.',
          ),
        ],
      ] as const
    )
      .map(
        ([
          id,
          ic,
          title,
          desc,
        ]) => `<button data-disaster="${id}" ${!state.settings.disastersEnabled ? 'disabled' : ''}>${icon(ic)}<strong>${title}</strong>
    <span>${desc}</span>
    </button>`,
      )
      .join('')}</div>`;
}
