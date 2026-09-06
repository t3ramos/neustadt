import { deserializeCity, expandCity } from '../simulation/city-simulation';
import type { CityState } from '../domain/types';

/** Only original v1 towns need extra land to expand their single-cell facilities. */
export function loadCityForPlay(raw: string): CityState {
  const city = deserializeCity(raw);
  return JSON.parse(raw).version === 1 ? expandCity(city, 64) : city;
}
