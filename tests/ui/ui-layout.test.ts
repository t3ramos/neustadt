import assert from 'node:assert/strict';
import test from 'node:test';
import { placeFloatingPanel } from '../../src/ui/layout.ts';

test('construction feedback stays visible at every edge of a narrow viewport', () => {
  const bounds = { left: 8, top: 74, right: 382, bottom: 672 },
    size = { width: 210, height: 128 };
  for (const x of [0, 8, 190, 382, 390])
    for (const y of [0, 74, 400, 672, 844]) {
      const position = placeFloatingPanel(bounds, size, { x, y });
      assert.ok(position.left >= bounds.left && position.left + size.width <= bounds.right);
      assert.ok(position.top >= bounds.top && position.top + size.height <= bounds.bottom);
    }
});

test('construction feedback avoids the pointer and adjacent HUD when space is available', () => {
  const bounds = { left: 8, top: 94, right: 1272, bottom: 605 },
    size = { width: 247, height: 136 },
    pointer = { x: 340, y: 265 };
  const obstacles = [
    { left: 20, top: 150, right: 270, bottom: 500 },
    { left: 1030, top: 380, right: 1260, bottom: 590 },
  ];
  const position = placeFloatingPanel(bounds, size, pointer, obstacles);
  const overlaps = (r: { left: number; top: number; right: number; bottom: number }) =>
    position.left < r.right &&
    position.left + size.width > r.left &&
    position.top < r.bottom &&
    position.top + size.height > r.top;
  assert.equal(
    overlaps({
      left: pointer.x - 14,
      top: pointer.y - 14,
      right: pointer.x + 14,
      bottom: pointer.y + 14,
    }),
    false,
  );
  assert.ok(obstacles.every((obstacle) => !overlaps(obstacle)));
});

test('safe-area offsets and an oversized measured panel still produce bounded coordinates', () => {
  assert.deepEqual(
    placeFloatingPanel(
      { left: 40, top: 80, right: 220, bottom: 200 },
      { width: 247, height: 136 },
      { x: 200, y: 160 },
    ),
    { left: 40, top: 80 },
  );
});
