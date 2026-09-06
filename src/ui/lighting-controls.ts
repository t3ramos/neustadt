import type { CityState, CitySceneApi, Weather } from '../domain/types';
import { initializeWeather, chooseWeather } from '../simulation/weather-cycle';
import { $ } from './dom';
export type GraphicsQuality = 'performance' | 'balanced' | 'ultra';

export function bindLightingControls(
  state: CityState,
  scene: CitySceneApi,
  changed: () => void,
  refreshPage: () => void,
  setQuality: (quality: GraphicsQuality) => void,
) {
  function setBuildingLights(enabled: boolean) {
    state.settings.buildingLights = enabled;
    scene.setBuildingLights(enabled);
    changed();
  }
  $('#dynamic-weather').onchange = (e) => {
    initializeWeather(state);
    state.settings.dynamicWeather = (e.target as HTMLInputElement).checked;
    changed();
  };
  document.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach(
    (b) =>
      (b.onclick = () => {
        const quality = b.dataset.quality as GraphicsQuality;
        scene.setGraphicsQuality(quality);
        setQuality(quality);
        refreshPage();
      }),
  );
  $('#building-lights').onchange = (e) => setBuildingLights((e.target as HTMLInputElement).checked);
  $('#day-cycle').onchange = (e) => {
    state.settings.dayNightCycle = (e.target as HTMLInputElement).checked;
    scene.setDayNightCycle(state.settings.dayNightCycle);
    changed();
  };
  $('#day-hour').oninput = (e) => {
    const hour = Number((e.target as HTMLInputElement).value);
    state.settings.timeOfDay = hour;
    state.settings.dayNightCycle = false;
    scene.setTimeOfDay(hour);
    scene.setDayNightCycle(false);
    $<HTMLInputElement>('#day-cycle').checked = false;
    $('#day-hour-value').textContent = `${hour}:00`;
    changed();
  };
  document.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach(
    (b) =>
      (b.onclick = () => {
        chooseWeather(state, b.dataset.weather as Weather);
        scene.setWeather(state.settings.weather);
        changed();
        refreshPage();
      }),
  );
}
