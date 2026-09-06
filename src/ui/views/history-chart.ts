import type { CityState } from '../../domain/types';
import { tr, getLocale, formatNumber as fmt } from '../../i18n/index';
import { calendarDate } from '../../simulation/calendar';

export function historyChart(state: CityState) {
  const points = state.history.slice(-120);
  if (points.length < 2)
    return `<div class="chart-empty">${tr('Die erste Statistik entsteht nach wenigen Spielsekunden.', 'The first statistics appear after a few seconds of simulation.')}</div>`;
  const max = Math.max(...points.map((p) => p.population), 1) * 1.15;
  const w = 660,
    h = 150,
    pad = 30;
  const coords = points.map(
    (p, i) =>
      `${pad + (i * (w - pad * 2)) / (points.length - 1)},${h - pad - (p.population / max) * (h - pad * 2)}`,
  );
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${tr(`Bevölkerungsentwicklung von ${fmt(points[0].population)} auf ${fmt(points.at(-1)!.population)} Einwohner`, `Population history from ${fmt(points[0].population)} to ${fmt(points.at(-1)!.population)} residents`)}">
    <defs>
    <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
    <stop offset="0%" stop-color="#7fac97" stop-opacity=".35"/>
    <stop offset="100%" stop-color="#7fac97" stop-opacity="0"/>
    </linearGradient>
    </defs>${[0.25, 0.5, 0.75].map((v) => `<line x1="${pad}" y1="${h - pad - v * (h - pad * 2)}" x2="${w - pad}" y2="${h - pad - v * (h - pad * 2)}" stroke="#e7eae2" stroke-dasharray="3 5"/>`).join('')}<path d="M ${pad},${h - pad} L ${coords.join(' L ')} L ${w - pad},${h - pad} Z" fill="url(#chart-fill)"/>
    <polyline points="${coords.join(' ')}" fill="none" stroke="#55856f" stroke-width="2.5" stroke-linejoin="round"/>
    <text x="${pad}" y="${h - 4}" fill="#8a958b" font-size="10">${calendarDate(points[0].month, 0, getLocale(), true)}</text>
    <text x="${w - pad}" y="${h - 4}" text-anchor="end" fill="#8a958b" font-size="10">${calendarDate(points.at(-1)!.month, 0, getLocale(), true)}</text>
    </svg>`;
}
