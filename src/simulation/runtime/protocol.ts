import type { CityState } from '../../domain/types';
import { getLocale, setLocale, type Locale } from '../../i18n/index';
import { tick } from '../city-simulation';

export interface StepIdentity {
  requestId: number;
  epoch: number;
  baseRevision: number;
  cityKey: string;
}
export interface StepRequest extends StepIdentity {
  type: 'step';
  state: CityState;
  locale: Locale;
}
export interface StepSuccess extends StepIdentity {
  type: 'result';
  state: CityState;
  durationMs: number;
}
export interface StepFailure extends StepIdentity {
  type: 'error';
  message: string;
}
export type StepResponse = StepSuccess | StepFailure;

/** Runs on the worker's isolated structured clone, never on the live city. */
export function executeStep(request: StepRequest): StepResponse {
  const { requestId, epoch, baseRevision, cityKey } = request;
  const identity = { requestId, epoch, baseRevision, cityKey };
  const previousLocale = getLocale();
  try {
    setLocale(request.locale);
    const start = performance.now();
    tick(request.state);
    return {
      ...identity,
      type: 'result',
      state: request.state,
      durationMs: performance.now() - start,
    };
  } catch (error) {
    return {
      ...identity,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    setLocale(previousLocale);
  }
}
