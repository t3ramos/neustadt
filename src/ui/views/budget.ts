import type { CityState } from '../../domain/types';
import { tr, formatNumber as fmt, formatCurrency as euro } from '../../i18n/index';
import { icon } from '../dom';
import { perMonth } from '../../simulation/calendar';

export function renderBudgetView(state: CityState) {
  const s = state.stats;
  return `<div class="budget-overview">
    <div>
    <small>${tr('Verfügbare Mittel', 'Available funds')}</small>
    <strong>${euro(state.money)}</strong>
    </div>
    <span class="budget-balance ${s.balance < 0 ? 'negative' : ''}">${s.balance >= 0 ? '+' : ''}${euro(perMonth(s.balance))}<small>${tr('pro Spielmonat', 'per calendar month')}</small>
    </span>
    </div>
    <div class="budget-columns">
    <div class="budget-card">
    <h3>${tr('Prognose pro Monat', 'Monthly projection')}</h3>
    <div>
    <span>${tr('Steuern & Wirtschaft', 'Taxes & economy')}</span>
    <b class="positive">+ ${euro(perMonth(s.income))}</b>
    </div>
    <div>
    <span>${tr('Betrieb & Stadtversorgung', 'Operations & city services')}</span>
    <b>− ${euro(perMonth(s.expenses))}</b>
    </div>
    <div class="total">
    <span>${tr('Überschuss', 'Surplus')}</span>
    <b>${euro(perMonth(s.balance))}</b>
    </div>
    </div>
    <div class="budget-card">
    <h3>${tr('Steuersatz', 'Tax rate')}</h3>
    <div class="slider-label">
    <span>${tr('Einwohner & Unternehmen', 'Residents & businesses')}</span>
    <b id="tax-value">${fmt(state.tax)} %</b>
    </div>
    <input id="tax-slider" type="range" min="0" max="25" step="1" value="${state.tax}" aria-label="${tr('Steuersatz', 'Tax rate')}"/>
    <p>${tr('Niedrige Steuern fördern Zuzug. Hohe Steuern erhöhen Einnahmen, senken aber die Zufriedenheit.', 'Low taxes attract new residents. High taxes increase revenue but reduce happiness.')}</p>
    </div>
    </div>
    <h3 class="funding-title">${tr('Investiere in Lebensqualität', 'Invest in quality of life')}</h3>
    <div class="funding-grid">${(
      [
        ['police', 'shield-check', tr('Polizei', 'Police')],
        ['fire', 'flame', tr('Feuerwehr', 'Fire department')],
        ['health', 'heart-pulse', tr('Gesundheit', 'Health')],
        ['education', 'graduation-cap', tr('Bildung', 'Education')],
      ] as const
    )
      .map(
        ([key, ic, label]) => `<div class="funding-item">
    <label for="funding-${key}">${icon(ic)} ${label}<b id="funding-${key}-value">${fmt(state.funding[key])} %</b>
    </label>
    <input type="range" id="funding-${key}" data-funding="${key}" min="0" max="150" step="10" value="${state.funding[key]}"/>
    </div>`,
      )
      .join('')}</div>
    <div class="loan-row">
    <div>
    <strong>${tr('Stadtanleihe', 'Municipal loan')}</strong>
    <small>${tr(`Offene Kredite: ${euro(state.loan)} · Zinsen in der laufenden Bilanz`, `Outstanding loans: ${euro(state.loan)} · Interest included in the running balance`)}</small>
    </div>
    <button class="button secondary" id="repay-loan" ${state.loan <= 0 ? 'disabled' : ''}>${tr(`${euro(10000)} zurückzahlen`, `Repay ${euro(10000)}`)}</button>
    <button class="button primary" id="take-loan">${tr(`${euro(10000)} aufnehmen`, `Borrow ${euro(10000)}`)}</button>
    </div>`;
}
