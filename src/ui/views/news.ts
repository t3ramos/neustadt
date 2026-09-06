import type { CityState } from '../../domain/types';
import { tr, getLocale, localizedEventTitle, localizedEventMessage } from '../../i18n/index';
import { icon, escape } from '../dom';
import { calendarDate } from '../../simulation/calendar';

export function renderNewsView(state: CityState) {
  return `<div class="event-list">${
    state.events.length
      ? state.events
          .map(
            (e) => `<article class="event ${e.type}">
    <span class="event-icon">${icon(e.type === 'good' ? 'sprout' : e.type === 'warning' ? 'triangle-alert' : 'newspaper')}</span>
    <div>
    <small>${calendarDate(e.month, 0, getLocale())}</small>
    <h3>${escape(localizedEventTitle(e))}</h3>
    <p>${escape(localizedEventMessage(e))}</p>
    </div>
    </article>`,
          )
          .join('')
      : `<p>${tr('Die erste Seite deiner Stadtgeschichte ist noch leer.', 'The first page of your city story is still empty.')}</p>`
  }</div>`;
}
