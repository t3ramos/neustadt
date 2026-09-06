/** Original procedural audio. No samples, network calls, or borrowed melodies.
 * Pausing silences transport/dispatch voices; weather and gentle music continue.
 * Construction is silent: a real user gesture must call unlock(). App owns persistence.
 */
export interface AudioPreferences {
  enabled: boolean;
  musicEnabled: boolean;
  master: number;
  music: number;
  effects: number;
  ambience: number;
}
export const DEFAULT_AUDIO_PREFERENCES: Readonly<AudioPreferences> = Object.freeze({
  enabled: true,
  musicEnabled: true,
  master: 0.35,
  music: 0.15,
  effects: 0.3,
  ambience: 0.2,
});
export interface AudioPoint {
  x: number;
  z: number;
}
export interface AudioSceneState {
  listener: AudioPoint;
  listenerRight?: AudioPoint;
  vehicles: readonly (AudioPoint & { id: string; speed: number; siren?: boolean })[];
  windTurbines?: readonly AudioPoint[];
  aircraft?: readonly (AudioPoint & { altitude?: number; active?: boolean })[];
  water?: readonly AudioPoint[];
  cityActivity?: number;
  driving?: { speed: number; throttle: number };
  rain?: number;
  wind?: number;
  night?: boolean;
  paused?: boolean;
}
export interface Soundscape {
  unlock(): Promise<boolean>;
  setPreferences(patch: Partial<AudioPreferences>): void;
  update(state: AudioSceneState): void;
  dispose(): void;
}
const clamp = (n: number, max = 1) => (Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0);
export function sanitizeAudioPreferences(
  p: Partial<AudioPreferences>,
  base: AudioPreferences = DEFAULT_AUDIO_PREFERENCES,
): AudioPreferences {
  return {
    enabled: p.enabled ?? base.enabled,
    musicEnabled: p.musicEnabled ?? base.musicEnabled,
    master: clamp(p.master ?? base.master),
    music: clamp(p.music ?? base.music),
    effects: clamp(p.effects ?? base.effects),
    ambience: clamp(p.ambience ?? base.ambience),
  };
}
export function nearestAudioSource<T extends AudioPoint>(
  sources: readonly T[],
  listener: AudioPoint,
  radius: number,
): { source: T; level: number; pan: number } | undefined {
  let nearest: T | undefined;
  let distance = radius;
  for (const source of sources) {
    const d = Math.hypot(source.x - listener.x, source.z - listener.z);
    if (d < distance) {
      nearest = source;
      distance = d;
    }
  }
  return nearest
    ? {
        source: nearest,
        level: (1 - distance / radius) ** 2,
        pan: Math.max(-1, Math.min(1, (nearest.x - listener.x) / Math.max(1, distance))),
      }
    : undefined;
}
// Warm extended voicings and a sparse, original twelve-step phrase, repeated slowly.
const CHORDS = [
  [48, 55, 62, 64],
  [45, 52, 59, 60],
  [41, 48, 55, 57],
  [43, 50, 57, 59],
];
export function musicNotes(step: number): number[] {
  const s = Math.max(0, Math.floor(step));
  const chord = CHORDS[Math.floor(s / 4) % CHORDS.length];
  return s % 4 === 0 ? [...chord] : s % 4 === 2 ? [chord[2] + 12] : [];
}
type Voice = {
  source: OscillatorNode | AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  pan: StereoPannerNode;
};
export function createSoundscape(
  initial: Partial<AudioPreferences> = {},
  contextFactory: () => AudioContext = () => new AudioContext(),
): Soundscape {
  let preferences = sanitizeAudioPreferences(initial),
    context: AudioContext | undefined,
    disposed = false;
  let master: GainNode, music: GainNode, ambience: GainNode, effects: GainNode;
  let state: AudioSceneState = { listener: { x: 0, z: 0 }, vehicles: [] };
  const voices = new Map<string, Voice>();
  const notes = new Set<OscillatorNode>();
  let nextNote = 0,
    step = 0,
    nextBird = 0;
  const smooth = (param: AudioParam, value: number, seconds = 0.25) =>
    param.setTargetAtTime(value, context!.currentTime, seconds);
  function preferencesChanged() {
    if (!context) return;
    smooth(master.gain, preferences.enabled ? preferences.master : 0, 0.12);
    smooth(music.gain, preferences.musicEnabled ? preferences.music : 0);
    smooth(ambience.gain, preferences.ambience);
    smooth(effects.gain, preferences.effects);
  }
  function makeVoice(
    name: string,
    bus: GainNode,
    noise: AudioBuffer | undefined,
    frequency: number,
    type: OscillatorType = 'sine',
  ) {
    const c = context!,
      source = noise ? c.createBufferSource() : c.createOscillator();
    if ('buffer' in source) {
      source.buffer = noise!;
      source.loop = true;
    } else {
      source.type = type;
      source.frequency.value = frequency;
    }
    const gain = c.createGain(),
      filter = c.createBiquadFilter(),
      pan = c.createStereoPanner();
    gain.gain.value = 0;
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    filter.Q.value = 0.5;
    source.connect(filter).connect(gain).connect(pan).connect(bus);
    source.start();
    voices.set(name, { source, gain, filter, pan });
  }
  function level(name: string, value: number, frequency?: number, pan = 0) {
    const v = voices.get(name)!;
    smooth(v.gain.gain, clamp(value));
    smooth(v.pan.pan, pan);
    if (frequency) {
      smooth(v.filter.frequency, frequency);
      if ('frequency' in v.source) smooth(v.source.frequency, frequency, 0.12);
    }
  }
  function playNote(midi: number, volume: number, duration: number, bird = false) {
    if (notes.size >= 8) return;
    const c = context!,
      oscillator = c.createOscillator(),
      gain = c.createGain(),
      time = c.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440 * 2 ** ((midi - 69) / 12), time);
    if (bird)
      oscillator.frequency.exponentialRampToValueAtTime(440 * 2 ** ((midi - 66) / 12), time + 0.1);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain).connect(bird ? ambience : music);
    notes.add(oscillator);
    oscillator.onended = () => {
      notes.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start();
    oscillator.stop(time + duration + 0.05);
  }
  function update(s: AudioSceneState) {
    state = s;
    if (!context || disposed || context.state !== 'running') return;
    const c = context,
      time = c.currentTime,
      moving = !s.paused,
      rain = clamp(s.rain ?? 0),
      wind = clamp(s.wind ?? 0.2);
    const spatial = <T extends AudioPoint>(sources: readonly T[], radius: number) => {
      const result = nearestAudioSource(sources, s.listener, radius);
      if (result && s.listenerRight) {
        const dx = result.source.x - s.listener.x,
          dz = result.source.z - s.listener.z;
        result.pan = Math.max(
          -1,
          Math.min(
            1,
            (dx * s.listenerRight.x + dz * s.listenerRight.z) / Math.max(1, Math.hypot(dx, dz)),
          ),
        );
      }
      return result;
    };
    const traffic = spatial(
        s.vehicles.filter((v) => Math.abs(v.speed) > 0.2),
        12,
      ),
      siren = spatial(
        s.vehicles.filter((v) => v.siren && Math.abs(v.speed) > 0.2),
        22,
      ),
      rotor = spatial(s.windTurbines ?? [], 10),
      plane = spatial(
        (s.aircraft ?? []).filter((p) => p.active !== false),
        30,
      ),
      water = spatial(s.water ?? [], 10);
    level('wind', 0.1 * wind, 450 + wind * 550);
    level('rain', rain * 0.2, 4500);
    level('water', (water?.level ?? 0) * 0.07, 1700, water?.pan);
    level('city', clamp(s.cityActivity ?? 0) * 0.055 * (s.night ? 0.4 : 1), 850);
    level(
      'rotor',
      (rotor?.level ?? 0) * 0.045 * (0.7 + 0.3 * Math.sin(time * 2.4)),
      110,
      rotor?.pan,
    );
    level(
      'traffic',
      moving ? (traffic?.level ?? 0) * 0.055 : 0,
      180 + Math.abs(traffic?.source.speed ?? 0) * 14,
      traffic?.pan,
    );
    level(
      'siren',
      moving ? (siren?.level ?? 0) * 0.035 : 0,
      650 + 220 * Math.sin(time * 5),
      siren?.pan,
    );
    level(
      'plane',
      moving ? (plane?.level ?? 0) * 0.1 : 0,
      350 + (plane?.level ?? 0) * 400,
      plane?.pan,
    );
    const speed = Math.abs(s.driving?.speed ?? 0),
      throttle = clamp(Math.abs(s.driving?.throttle ?? 0));
    level(
      'engine',
      moving && s.driving ? 0.045 + throttle * 0.04 + clamp(speed / 30) * 0.025 : 0,
      40 + Math.min(speed, 45) * 2.2 + throttle * 35,
    );
    // Wall-clock scheduling is driven by the app update; never backfill missed notes.
    if (
      preferences.enabled &&
      preferences.musicEnabled &&
      preferences.music > 0 &&
      time >= nextNote
    ) {
      for (const midi of musicNotes(step++)) playNote(midi, 0.045, 3.2);
      nextNote = time + 2.4;
    }
    if (preferences.enabled && time >= nextBird) {
      if (rain < 0.25 && !s.paused)
        playNote(
          s.night ? 95 : 88 + (step % 5),
          s.night ? 0.006 : 0.014,
          s.night ? 0.7 : 0.24,
          true,
        );
      nextBird = time + (s.night ? 9 : 6) + (step % 4);
    }
  }
  return {
    async unlock() {
      if (disposed) return false;
      try {
        if (!context) {
          const c = contextFactory();
          context = c;
          master = c.createGain();
          music = c.createGain();
          ambience = c.createGain();
          effects = c.createGain();
          master.gain.value = 0;
          music.gain.value = 0;
          ambience.gain.value = 0;
          effects.gain.value = 0;
          const limiter = c.createDynamicsCompressor();
          limiter.threshold.value = -16;
          limiter.ratio.value = 5;
          limiter.knee.value = 16;
          master.connect(limiter).connect(c.destination);
          music.connect(master);
          ambience.connect(master);
          effects.connect(master);
          const noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate),
            data = noise.getChannelData(0);
          let seed = 92471,
            last = 0;
          for (let i = 0; i < data.length; i++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            last = (last + 0.12 * ((seed / 4294967296) * 2 - 1)) / 1.12;
            data[i] = last * 3;
          }
          for (const name of ['wind', 'rain', 'water', 'city', 'rotor'])
            makeVoice(name, ambience, noise, 600);
          for (const name of ['traffic', 'plane']) makeVoice(name, effects, noise, 300);
          makeVoice('engine', effects, undefined, 50, 'triangle');
          makeVoice('siren', effects, undefined, 700);
          preferencesChanged();
        }
        await context.resume();
        update(state);
        return context.state === 'running';
      } catch {
        return false;
      }
    },
    setPreferences(patch) {
      preferences = sanitizeAudioPreferences(patch, preferences);
      preferencesChanged();
    },
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const v of voices.values()) {
        try {
          v.source.stop();
        } catch {
          /* already stopped */
        }
        v.source.disconnect();
        v.gain.disconnect();
        v.filter.disconnect();
        v.pan.disconnect();
      }
      voices.clear();
      for (const note of notes) {
        try {
          note.stop();
        } catch {
          /* already ended */
        }
      }
      notes.clear();
      if (context) void context.close().catch(() => {});
    },
  };
}
