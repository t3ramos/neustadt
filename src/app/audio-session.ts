import {
  createSoundscape,
  DEFAULT_AUDIO_PREFERENCES,
  sanitizeAudioPreferences,
  type AudioPreferences,
  type AudioSceneState,
} from '../audio/soundscape';
import { safePreferenceGet, safePreferenceSet } from '../persistence/storage';

const preferenceKey = 'neustadt-audio';
function loadAudioPreferences(): AudioPreferences {
  try {
    const value: unknown = JSON.parse(safePreferenceGet(preferenceKey) ?? '{}');
    if (!value || typeof value !== 'object') return { ...DEFAULT_AUDIO_PREFERENCES };
    const raw = value as Record<string, unknown>;
    const patch: Partial<AudioPreferences> = {};
    for (const key of ['enabled', 'musicEnabled'] as const) {
      if (typeof raw[key] === 'boolean') patch[key] = raw[key];
    }
    for (const key of ['master', 'music', 'effects', 'ambience'] as const) {
      if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) patch[key] = raw[key];
    }
    return sanitizeAudioPreferences(patch);
  } catch {
    return { ...DEFAULT_AUDIO_PREFERENCES };
  }
}

/** Owns user activation, local sound preferences and the 10 Hz audio update budget. */
export function createAudioSession() {
  let preferences = loadAudioPreferences();
  const soundscape = createSoundscape(preferences);
  let unlocking = false;
  let unlocked = false;
  let elapsed = 0;
  async function unlock() {
    if (unlocked || unlocking || !preferences.enabled) return;
    unlocking = true;
    try {
      unlocked = await soundscape.unlock();
    } finally {
      unlocking = false;
    }
    if (unlocked) {
      document.removeEventListener('pointerdown', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
    }
  }
  function onGesture(event: Event) {
    if (event.isTrusted) void unlock();
  }
  function onVisibility() {
    soundscape.setPreferences({ enabled: preferences.enabled && !document.hidden });
  }
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('keydown', onGesture, true);
  document.addEventListener('visibilitychange', onVisibility);
  return {
    get preferences(): AudioPreferences {
      return { ...preferences };
    },
    setPreferences(patch: Partial<AudioPreferences>) {
      preferences = sanitizeAudioPreferences(patch, preferences);
      soundscape.setPreferences(preferences);
      safePreferenceSet(preferenceKey, JSON.stringify(preferences));
      void unlock();
    },
    update(delta: number, getSceneState: () => AudioSceneState, paused: boolean) {
      elapsed += delta;
      if (
        elapsed < 0.1 ||
        document.hidden ||
        !unlocked ||
        !preferences.enabled ||
        preferences.master <= 0
      )
        return;
      elapsed %= 0.1;
      const state = getSceneState();
      soundscape.update({ ...state, paused: state.paused || paused });
    },
    dispose() {
      document.removeEventListener('pointerdown', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
      document.removeEventListener('visibilitychange', onVisibility);
      soundscape.dispose();
    },
  };
}
