import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSoundscape,
  musicNotes,
  nearestAudioSource,
  sanitizeAudioPreferences,
  type AudioSceneState,
} from '../../src/audio/soundscape.ts';

class Param {
  value = 0;
  setTargetAtTime(v: number) {
    assert.ok(Number.isFinite(v));
    this.value = v;
  }
  setValueAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
  }
  exponentialRampToValueAtTime(v: number) {
    this.value = v;
  }
}
class Node {
  disconnected = false;
  connect<T>(node: T): T {
    return node;
  }
  disconnect() {
    this.disconnected = true;
  }
}
class Source extends Node {
  frequency = new Param();
  type = 'sine';
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start() {
    this.started = true;
  }
  stop(at?: number) {
    this.stopped = true;
    if (at === undefined) this.onended?.();
  }
}
class FakeContext {
  currentTime = 0;
  sampleRate = 100;
  state = 'suspended';
  destination = new Node();
  resumeCount = 0;
  closeCount = 0;
  sources: Source[] = [];
  gains: (Node & { gain: Param })[] = [];
  createGain() {
    const node = Object.assign(new Node(), { gain: new Param() });
    this.gains.push(node);
    return node;
  }
  createDynamicsCompressor() {
    return Object.assign(new Node(), {
      threshold: new Param(),
      ratio: new Param(),
      knee: new Param(),
    });
  }
  createBiquadFilter() {
    return Object.assign(new Node(), { frequency: new Param(), Q: new Param(), type: 'lowpass' });
  }
  createStereoPanner() {
    return Object.assign(new Node(), { pan: new Param() });
  }
  createOscillator() {
    const source = new Source();
    this.sources.push(source);
    return source;
  }
  createBufferSource() {
    return Object.assign(this.createOscillator(), { buffer: null, loop: false });
  }
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  async resume() {
    this.resumeCount++;
    this.state = 'running';
  }
  async close() {
    this.closeCount++;
    this.state = 'closed';
  }
  finishNotes() {
    for (const source of this.sources.slice(9)) source.onended?.();
  }
}
const snapshot: AudioSceneState = {
  listener: { x: 0, z: 0 },
  vehicles: [{ id: 'ambulance', x: 1, z: 0, speed: 3, siren: true }],
  driving: { speed: 8, throttle: 1 },
  aircraft: [{ x: 1, z: 0, active: true }],
  windTurbines: [{ x: 1, z: 0 }],
};

test('audio is lazy, unlock is reusable, mute ramps immediately, and disposal stops all voices', async () => {
  let allocations = 0;
  const context = new FakeContext();
  const audio = createSoundscape({}, () => {
    allocations++;
    return context as unknown as AudioContext;
  });
  audio.update(snapshot);
  assert.equal(allocations, 0);
  assert.equal(await audio.unlock(), true);
  assert.equal(allocations, 1);
  assert.equal(context.sources.length, 14); // 9 loops + 4 chord tones + a bird
  await audio.unlock();
  assert.equal(allocations, 1);
  assert.equal(context.sources.length, 14);
  audio.setPreferences({ enabled: false });
  assert.equal(context.gains[0].gain.value, 0);
  audio.dispose();
  audio.dispose();
  assert.equal(context.closeCount, 1);
  assert.ok(context.sources.every((s) => s.stopped));
  assert.equal(await audio.unlock(), false);
});
test('paused transport goes quiet and parked emergency vehicles never sound their siren', async () => {
  const context = new FakeContext(),
    audio = createSoundscape({}, () => context as unknown as AudioContext);
  audio.update(snapshot);
  await audio.unlock();
  // Four bus gains precede gains for wind/rain/water/city/rotor/traffic/plane/engine/siren.
  for (const index of [9, 10, 11, 12]) assert.ok(context.gains[index].gain.value > 0);
  audio.update({ ...snapshot, paused: true });
  for (const index of [9, 10, 11, 12]) assert.equal(context.gains[index].gain.value, 0);
  audio.update({ ...snapshot, vehicles: [{ id: 'parked', x: 0, z: 0, speed: 0, siren: true }] });
  assert.equal(context.gains[12].gain.value, 0);
  audio.dispose();
});
test('scheduler never backfills notes after a suspended tab and keeps voice allocation bounded', async () => {
  const context = new FakeContext(),
    audio = createSoundscape({}, () => context as unknown as AudioContext);
  await audio.unlock();
  context.finishNotes();
  const before = context.sources.length;
  context.currentTime = 10000;
  audio.update(snapshot);
  assert.ok(context.sources.length - before <= 5);
  for (let i = 0; i < 100; i++) {
    context.currentTime += 3;
    audio.update(snapshot);
  }
  assert.ok(
    context.sources.length - before <= 8,
    'at most eight live transient notes, even without onended callbacks',
  );
  audio.dispose();
});
test('engine responds to speed and throttle; nearest source ignores distant and invalid coordinates', async () => {
  const context = new FakeContext(),
    audio = createSoundscape({}, () => context as unknown as AudioContext);
  await audio.unlock();
  audio.update({ ...snapshot, driving: { speed: 0, throttle: 0 } });
  const idle = context.sources[7].frequency.value;
  audio.update(snapshot);
  assert.ok(context.sources[7].frequency.value > idle);
  audio.dispose();
  assert.equal(
    nearestAudioSource(
      [
        { x: 100, z: 100 },
        { x: NaN, z: 0 },
      ],
      { x: 0, z: 0 },
      10,
    ),
    undefined,
  );
  const nearest = nearestAudioSource(
    [
      { x: 8, z: 0 },
      { x: 2, z: 0 },
    ],
    { x: 0, z: 0 },
    10,
  )!;
  assert.equal(nearest.source.x, 2);
  assert.ok(nearest.level > 0.6);
});
test('preferences clamp malformed levels and music uses reproducible original extended voicings', () => {
  const prefs = sanitizeAudioPreferences({ master: NaN, music: 3, effects: -1 });
  assert.equal(prefs.master, 0);
  assert.equal(prefs.music, 1);
  assert.equal(prefs.effects, 0);
  assert.deepEqual(musicNotes(0), musicNotes(16));
  assert.equal(musicNotes(1).length, 0);
  assert.equal(musicNotes(2).length, 1);
});
