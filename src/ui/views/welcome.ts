import type { CityState } from '../../domain/types';
import { tr, formatNumber as fmt } from '../../i18n/index';
import { icon, escape } from '../dom';

export function renderWelcomeView(state: CityState) {
  return `<p class="welcome-copy">${tr('Übernimm eine lebendige Metropole oder gründe deine eigene Stadt zwischen Bergen, Wäldern und Wasser.', 'Take over a living metropolis or build your own city among mountains, forests and water.')}</p>
    <div class="welcome-city">
    <span class="eyebrow">${tr('DEINE METROPOLE WARTET', 'YOUR METROPOLIS AWAITS')}</span>
    <h3>${escape(state.name)}</h3>
    <p>${tr('Ein Seepark im Zentrum, lebendige Viertel und eine markante Skyline.', 'A central lakeside park, lively neighborhoods and a distinctive skyline.')}</p>
    <div class="welcome-facts">
    <span>${fmt(state.stats.population)} ${tr('Einwohner', 'residents')}</span>
    <span>${state.size} × ${state.size} ${tr('Felder', 'tiles')}</span>
    </div>
    </div>
    <div class="welcome-actions">
    <button id="adopt-new-york" class="button primary">${icon('building-2')} ${tr('Kassel übernehmen', 'Take over Kassel')} ${icon('arrow-up-right')}</button>
    <button id="found-own-city" class="button secondary">${icon('sprout')} ${tr('Eigene Stadt gründen', 'Found your own city')}</button>
    </div>
    <small class="welcome-footnote">${tr('Dein Fortschritt wird lokal in diesem Browser gespeichert.', 'Your progress is saved locally in this browser.')}</small>
`;
}
