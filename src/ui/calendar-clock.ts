import type { CityState } from '../domain/types';
import { calendarDate, calendarState } from '../simulation/calendar';
import { tr, getLocale } from '../i18n/index';
import { $, icon, refreshIcons } from './dom';

export function renderCalendarClock(state: CityState, tickAccumulator: number, hour: number) {
  $('#game-date').textContent = calendarDate(state.month, tickAccumulator, getLocale());
  $('#game-date').title = tr(
    'Ein Monat dauert 60 Sekunden bei 1× · 12 Monate ergeben ein Jahr',
    'One month takes 60 seconds at 1× · 12 months make a year',
  );
  const date = calendarState(state.month, tickAccumulator);
  const progress = $('#month-progress');
  if (progress) {
    progress.setAttribute('aria-valuenow', String(Math.round(date.fraction * 100)));
    progress.setAttribute(
      'aria-valuetext',
      tr(
        `Tag ${date.day} · ${calendarDate(state.month, tickAccumulator, getLocale())}`,
        `Day ${date.day} · ${calendarDate(state.month, tickAccumulator, getLocale())}`,
      ),
    );
    progress.querySelector<HTMLElement>('i')!.style.width = `${date.fraction * 100}%`;
  }
  $('#season').textContent =
    state.settings.weather === 'rain' ? tr('REGEN', 'RAIN') : tr('KLAR', 'CLEAR');
  $('#day-clock').textContent =
    `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;
  const night = hour < 6 || hour >= 19;
  const button = $('#night-btn');
  if (button.getAttribute('aria-pressed') !== String(night)) {
    button.setAttribute('aria-pressed', String(night));
    button.classList.toggle('active', night);
    button.innerHTML = icon(night ? 'moon' : 'sun');
    refreshIcons(button);
  }
  return night;
}
