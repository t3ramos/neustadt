import test from 'node:test';
import assert from 'node:assert/strict';
import { nextCitySize } from '../../src/world/scenarios';

test('existing smaller cities expand directly into the full 128 region', () => {
  for (const size of [40, 64, 96, 127]) assert.equal(nextCitySize(size), 128);
  for (const size of [128, 160]) assert.equal(nextCitySize(size), null);
});
