import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceLandmarkDiscovery } from '../../src/ui/landmark-unlock';
const advance = (keys: string[]) => keys.reduce(advanceLandmarkDiscovery, 0);
test('landmark discovery requires the complete ordered sequence, case independently', () => {
  assert.equal(advance(['b', 'c', 'i']), 3);
  assert.equal(advance(['b', 'C', 'i', 'S']), 4);
  assert.equal(advance(['b', 'c', 'x', 'i', 's']), 0);
  assert.equal(advance(['b', 'b', 'c', 'i', 's']), 4);
  assert.equal(advance(['b', 'Escape', 'c', 'i', 's']), 0);
});
