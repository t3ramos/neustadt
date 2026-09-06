import type { AudioPreferences } from '../../audio/soundscape';
import { tr } from '../../i18n/index';

export function renderAudioView(preferences: AudioPreferences): string {
  const sliders: [
    keyof Pick<AudioPreferences, 'master' | 'music' | 'effects' | 'ambience'>,
    string,
  ][] = [
    ['master', tr('Gesamtlautstärke', 'Master volume')],
    ['music', tr('Hintergrundmusik', 'Background music')],
    ['effects', tr('Fahrzeuge & Effekte', 'Vehicles & effects')],
    ['ambience', tr('Stadt & Natur', 'City & nature')],
  ];
  return `<section class="audio-settings">
        <h3>${tr('Klang & Musik', 'Sound & music')}</h3>
        <label class="disaster-switch"><span><strong>${tr('Ton einschalten', 'Enable sound')}</strong>
            <small>${tr('Leise Stadtgeräusche, Wetter und Fahrzeuge passend zu deiner Perspektive.', 'Gentle city sounds, weather and vehicles that follow your view.')}</small></span>
            <input id="audio-enabled" type="checkbox" ${preferences.enabled ? 'checked' : ''}/></label>
        <label class="disaster-switch"><span><strong>${tr('Hintergrundmusik', 'Background music')}</strong>
            <small>${tr('Ruhige, eigens erzeugte Musik für deine Stadt.', 'Calm, original music for your city.')}</small></span>
            <input id="audio-music-enabled" type="checkbox" ${preferences.musicEnabled ? 'checked' : ''}/></label>
        <div class="audio-levels">${sliders
          .map(
            ([key, label]) => `<label for="audio-${key}">
            <span>${label}<b id="audio-${key}-value">${Math.round(preferences[key] * 100)} %</b></span>
            <input id="audio-${key}" data-audio-level="${key}" type="range" min="0" max="100" step="1" value="${Math.round(preferences[key] * 100)}"/>
        </label>`,
          )
          .join('')}</div>
    </section>`;
}
