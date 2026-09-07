import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameLimiter } from '../../src/rendering/frame-limit.ts';

test('render limit holds at 60 FPS on 60–500 Hz displays without slowing 30 Hz displays', () => {
  for (const hz of [30, 60, 75, 120, 144, 240, 500]) {
    const render = createFrameLimiter();
    let count = 0;
    for (let frame = 0; frame < hz * 10; frame++) if (render((frame * 1000) / hz)) count++;
    assert.equal(count, Math.min(hz, 60) * 10, `${hz} Hz`);
  }
});

test('resuming after a long pause never produces a catch-up burst', () => {
  const render = createFrameLimiter();
  assert.equal(render(0), true);
  assert.equal(render(60000), true);
  for (let ms = 1; ms <= 16; ms++) assert.equal(render(60000 + ms), false);
  assert.equal(render(60017), true);
});
