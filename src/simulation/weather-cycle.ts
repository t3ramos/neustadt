import type { CityState, Weather } from '../domain/types';

function duration(seed: number, cycle: number, weather: Weather): number {
  const n = Math.sin(seed * 0.017 + cycle * 78.233 + 13.4) * 43758.5453;
  const fraction = n - Math.floor(n);
  return weather === 'rain' ? 60 + fraction * 90 : 150 + fraction * 150;
}

/** Persist phase and remaining simulation seconds so reloading never resets the forecast. */
export function initializeWeather(state: CityState): void {
  const s = state.settings;
  s.dynamicWeather ??= true;
  s.weatherCycle ??= 0;
  s.weatherRemaining ??= duration(state.seed, s.weatherCycle, s.weather);
}

export function chooseWeather(state: CityState, weather: Weather, automatic = false): void {
  initializeWeather(state);
  const s = state.settings;
  s.weather = weather;
  s.dynamicWeather = automatic;
  s.weatherCycle!++;
  s.weatherRemaining = duration(state.seed, s.weatherCycle!, weather);
}

/** Clear spells and finite showers. Weather never triggers a destructive disaster. */
export function advanceWeather(state: CityState, simulationSeconds: number): boolean {
  initializeWeather(state);
  const s = state.settings;
  if (!s.dynamicWeather || !Number.isFinite(simulationSeconds) || simulationSeconds <= 0)
    return false;
  s.weatherRemaining! -= simulationSeconds;
  let changed = false;
  while (s.weatherRemaining! <= 0) {
    s.weather = s.weather === 'rain' ? 'clear' : 'rain';
    s.weatherCycle!++;
    s.weatherRemaining! += duration(state.seed, s.weatherCycle!, s.weather);
    changed = true;
  }
  return changed;
}
