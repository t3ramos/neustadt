import type { CityState } from '../../domain/types';
import { tr, formatNumber as fmt } from '../../i18n/index';
import { icon, clamp } from '../dom';
import { historyChart } from './history-chart';

export function renderReportsView(state: CityState) {
  const s = state.stats;
  return `<div class="report-grid">${[
    ['users', tr('Einwohner', 'Residents'), fmt(s.population)],
    ['briefcase-business', tr('Arbeitsplätze', 'Jobs'), fmt(s.jobs)],
    ['smile', tr('Zufriedenheit', 'Happiness'), `${fmt(s.happiness)} %`],
    ['leaf', tr('Umweltbelastung', 'Pollution'), `${fmt(s.pollution)} %`],
  ]
    .map(
      ([ic, label, v]) => `<div class="report-metric">${icon(ic)}<small>${label}</small>
    <strong>${v}</strong>
    </div>`,
    )
    .join('')}</div>
    <div class="chart-header">
    <h3>${tr('Bevölkerungsentwicklung', 'Population history')}</h3>
    <span>${tr('Verlauf der letzten Monate', 'Recent calendar months')}</span>
    </div>
    <div class="population-chart">${historyChart(state)}</div>
    <div class="service-grid">${[
      ['zap', tr('Strom', 'Power'), s.powerDemand, s.powerSupply, tr('Einh.', 'units')],
      ['droplets', tr('Wasser', 'Water'), s.waterDemand, s.waterSupply, tr('Einh.', 'units')],
    ]
      .map(
        ([ic, label, demand, supply, unit]) => `<div class="service-capacity">
    <div>${icon(String(ic))}<b>${label}</b>
    <span>${fmt(Number(demand))} / ${fmt(Number(supply))} ${unit}</span>
    </div>
    <div class="progress-track">
    <div style="width:${clamp((Number(demand) / Math.max(1, Number(supply))) * 100, 0, 100)}%;background:${Number(demand) > Number(supply) ? '#d88162' : '#74a695'}">
    </div>
    </div>
    </div>`,
      )
      .join('')}</div>
    <div class="quality-grid">${[
      [tr('Bildung', 'Education'), s.education],
      [tr('Gesundheit', 'Health'), s.health],
      [tr('Sicherheit', 'Safety'), s.safety],
      [tr('Verkehrsdichte', 'Traffic density'), s.traffic],
    ]
      .map(
        ([label, value]) => `<div>
    <span>${label}</span>
    <b>${fmt(Number(value))} %</b>
    </div>`,
      )
      .join('')}</div>
    <p class="modal-note">${tr('Versorgte Bauzonen wachsen mit der Nachfrage. Parks und Stadtdienste erhöhen die Lebensqualität; Industrie kann Nachbargrundstücke belasten.', 'Serviced zones grow with demand. Parks and city services improve quality of life; industry can pollute nearby properties.')}</p>`;
}
