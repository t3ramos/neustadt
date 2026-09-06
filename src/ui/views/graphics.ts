import type { CityState } from '../../domain/types';
import { tr } from '../../i18n/index';
import { icon } from '../dom';

export function renderGraphicsView(state: CityState, quality: string) {
  return `<label class="disaster-switch">
    <span>
    <strong>${tr('Dynamisches Wetter', 'Dynamic weather')}</strong>
    <small>${tr('Sonnige Phasen wechseln automatisch mit kurzen Regenschauern.', 'Clear spells automatically alternate with short rain showers.')}</small>
    </span>
    <input id="dynamic-weather" type="checkbox" ${state.settings.dynamicWeather !== false ? 'checked' : ''}/>
    </label>
    <div class="weather-options">
    <div>
    <h3>${tr('Wetter & Oberflächen', 'Weather & surfaces')}</h3>
    <p>${tr('Regen erzeugt nasse Straßen und Pfützen, die danach wieder trocknen. Manuelle Wetterwahl pausiert die Automatik.', 'Rain wets roads and creates puddles that dry afterwards. Choosing weather manually pauses the automatic cycle.')}</p>
    </div>
    <button class="button ${state.settings.weather === 'clear' ? 'primary' : 'secondary'}" data-weather="clear">${icon('sun')} ${tr('Klar', 'Clear')}</button>
    <button class="button ${state.settings.weather === 'rain' ? 'primary' : 'secondary'}" data-weather="rain">${icon('cloud-rain')} ${tr('Regen', 'Rain')}</button>
    </div>
    <div class="daylight-settings">
    <label for="building-lights">${tr('Gebäude- und Straßenbeleuchtung', 'Building and street lighting')}<input id="building-lights" type="checkbox" ${state.settings.buildingLights ? 'checked' : ''}/>
    </label>
    <small>${tr('Fenster, Laternen und ihre Lichtflächen einschalten. Auch direkt oben mit der Glühbirne oder Taste L.', 'Turn on windows, streetlights, and their pools of light. You can also use the lightbulb above or press L.')}</small>
    <label for="day-cycle">${tr('Automatischer Tag-Nacht-Wechsel', 'Automatic day-night cycle')}<input id="day-cycle" type="checkbox" ${state.settings.dayNightCycle ? 'checked' : ''}/>
    </label>
    <small>${tr('Ein Tag dauert etwa vier Minuten bei laufender Stadt. Sonne und Schatten folgen der Uhrzeit.', 'A day lasts about four minutes while the city is running. The sun and shadows follow the time of day.')}</small>
    <label for="day-hour">${tr('Tageszeit ', 'Time of day ')}<b id="day-hour-value">${Math.floor(state.settings.timeOfDay)}:00</b>
    </label>
    <input id="day-hour" type="range" min="0" max="23" step="1" value="${Math.floor(state.settings.timeOfDay)}"/>
    </div>
    <p class="modal-note">${tr('Wähle Auflösung, Schattendetails und Kantenglättung für deinen Rechner.', 'Choose the resolution, shadow detail, and antialiasing that suit your computer.')}</p>
    <div class="graphics-presets">${(
      [
        [
          'performance',
          tr('Flüssig', 'Performance'),
          tr('Reduzierte Auflösung und kompakte Schatten', 'Lower resolution and simpler shadows'),
        ],
        [
          'balanced',
          tr('Ausgewogen', 'Balanced'),
          tr('Weiche Schatten und geglättete Kanten', 'Soft shadows and smooth edges'),
        ],
        [
          'ultra',
          tr('Sehr hoch', 'Ultra'),
          tr(
            'Hohe Auflösung und feinere Schattendetails',
            'High resolution and finer shadow detail',
          ),
        ],
      ] as const
    )
      .map(
        ([
          id,
          label,
          desc,
        ]) => `<button class="graphics-preset ${quality === id ? 'active' : ''}" data-quality="${id}">${icon(id === 'performance' ? 'gauge' : id === 'balanced' ? 'sun' : 'sparkles')}<strong>${label}</strong>
    <small>${desc}</small>
    </button>`,
      )
      .join('')}</div>`;
}
