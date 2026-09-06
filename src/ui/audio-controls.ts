import type { AudioPreferences } from '../audio/soundscape';
import { $ } from './dom';

export function bindAudioControls(change: (patch: Partial<AudioPreferences>) => void): void {
  $<HTMLInputElement>('#audio-enabled').onchange = (event) => {
    change({ enabled: (event.target as HTMLInputElement).checked });
  };
  $<HTMLInputElement>('#audio-music-enabled').onchange = (event) => {
    change({ musicEnabled: (event.target as HTMLInputElement).checked });
  };
  document.querySelectorAll<HTMLInputElement>('[data-audio-level]').forEach((input) => {
    input.oninput = () => {
      const key = input.dataset.audioLevel as 'master' | 'music' | 'effects' | 'ambience';
      const value = Number(input.value) / 100;
      $(`#audio-${key}-value`).textContent = `${Math.round(value * 100)} %`;
      change({ [key]: value });
    };
  });
}
