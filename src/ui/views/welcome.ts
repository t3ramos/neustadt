import type { CityState } from '../../domain/types';
import { tr, formatNumber as fmt } from '../../i18n/index';
import { icon } from '../dom';

export function renderWelcomeView(state: CityState) {
  return `<p class="welcome-copy">${tr('Übernimm eine lebendige Metropole oder gründe deine eigene Stadt zwischen Bergen, Wäldern und Wasser.', 'Take over a living metropolis or build your own city among mountains, forests and water.')}</p>
    <div class="welcome-city">
    <span class="eyebrow">${tr('DEINE METROPOLE WARTET', 'YOUR METROPOLIS AWAITS')}</span>
    <h3>New York</h3>
    <p>${tr('Hochhäuser am Central Park, belebte Viertel und ein Hafen am Wasser.', 'Towers around Central Park, lively neighborhoods and a waterfront harbor.')}</p>
    <div class="welcome-facts">
    <span>${fmt(state.stats.population)} ${tr('Einwohner', 'residents')}</span>
    <span>96 × 96 ${tr('Felder', 'tiles')}</span>
    </div>
    </div>
    <div class="welcome-actions">
    <button id="adopt-new-york" class="button primary">${icon('building-2')} ${tr('New York übernehmen', 'Take over New York')} ${icon('arrow-up-right')}</button>
    <button id="found-own-city" class="button secondary">${icon('sprout')} ${tr('Eigene Stadt gründen', 'Found your own city')}</button>
    </div>
    <small class="welcome-footnote">${tr('Dein Fortschritt wird lokal in diesem Browser gespeichert.', 'Your progress is saved locally in this browser.')}</small>
`;
}
