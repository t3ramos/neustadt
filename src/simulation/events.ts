/** Localized city event records and shared command results. */
import type { BuildResult, CityState, GameEvent } from '../domain/types';
import { eventText } from '../i18n/index';
import type { BilingualText } from './catalog';

export function addEvent(
  state: CityState,
  title: BilingualText,
  message: BilingualText,
  type: GameEvent['type'] = 'info',
): void {
  state.events.unshift({
    id: (state.events[0]?.id ?? 0) + 1,
    month: state.month,
    ...eventText(title[0], title[1], message[0], message[1]),
    type,
  });
  state.events = state.events.slice(0, 40);
}

export function result(ok: boolean, message: string, cost = 0, count = 0): BuildResult {
  return {
    ok,
    message,
    cost,
    count,
  };
}
