import { START_CITY_SIZE } from '../../world/scenarios';
import { tr } from '../../i18n/index';
import { icon } from '../dom';

export function renderNewCityView(awaitingStart: boolean) {
  return `${!awaitingStart ? `<p class="modal-note">${tr('Exportiere deine bisherige Stadt, wenn du sie behalten möchtest. Eine neue Stadt ersetzt den automatischen Spielstand.', 'Export your current city if you want to keep it. A new city replaces the automatic save.')}</p>` : ''}<div class="new-world-summary">${icon('mountain')}<div>
    <strong>${tr(`${START_CITY_SIZE} × ${START_CITY_SIZE} · Viel Platz für deine Stadt`, `${START_CITY_SIZE} × ${START_CITY_SIZE} · Room for your city`)}</strong>
    <p>${tr('Eine große, ebene Fläche im Zentrum bietet Platz für ganze Stadtviertel. Wälder, Hügel und Wasser liegen weiter außen.', 'A broad, flat central area leaves room for entire neighborhoods. Forests, hills and water sit farther out.')}</p>
    </div>
    </div>
    <label class="form-label" for="new-name">${tr('Name der Stadt', 'City name')}<input id="new-name" type="text" maxlength="40" value="${tr('Meine Stadt', 'My city')}" autocomplete="off"/>
    </label>
    <label class="form-label" for="new-seed">${tr('Dein Landschafts-Seed', 'Your landscape seed')}<div class="seed-input">
    <input id="new-seed" type="text" maxlength="80" value="${Math.floor(Math.random() * 999999) + 1}" spellcheck="false" autocomplete="off"/>
    <button id="random-seed" type="button" class="button secondary" title="${tr('Neuen Seed würfeln', 'Roll a new seed')}" aria-label="${tr('Neuen Seed würfeln', 'Roll a new seed')}">${icon('shuffle')}</button>
    </div>
    </label>
    <p class="modal-note">${tr('Zahl oder Wort – derselbe Seed erzeugt dieselbe Landschaft. Das großzügige, ebene Zentrum bleibt für deine ersten Viertel frei.', 'Number or word — the same seed creates the same landscape. The spacious, level center stays clear for your first neighborhoods.')}</p>
    <div class="new-city-options">
    <button id="new-empty" class="button primary">${icon('sprout')} ${tr('Eigene Stadt starten', 'Start your own city')}</button>
    <button id="new-starter" class="button secondary">${icon('building-2')} ${tr('Kassel übernehmen', 'Take over Kassel')}</button>
    </div>`;
}
