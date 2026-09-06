import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDate, calendarState, perMonth, perMinute } from '../../src/simulation/calendar';
test('calendar advances each minute, crosses year and preserves fractional progress', () => {
  assert.equal(calendarDate(0), 'Januar 2000');
  assert.equal(calendarDate(11, 4.999), 'Januar 2000');
  assert.equal(calendarDate(12), 'Februar 2000');
  assert.equal(calendarDate(143, 4.999), 'Dezember 2000');
  assert.equal(calendarDate(144), 'Januar 2001');
  assert.equal(calendarDate(144, 0, 'en'), 'January 2001');
  assert.equal(calendarState(6, 0).fraction, 0.5);
  assert.equal(calendarState(12 + 11, 4).day, 29);
  assert.equal(calendarDate(-3), 'Januar 2000');
  assert.equal(calendarDate(Infinity, NaN), 'Januar 2000');
});
test('monthly projections keep existing economic pace', () => {
  assert.equal(perMonth(125), 1500);
  assert.equal(perMonth(125), perMinute(125));
  assert.deepEqual(calendarState(1296, 2.5), {
    month: 0,
    year: 2009,
    day: 2,
    fraction: 2.5 / 60,
    elapsedMonths: 108,
  });
});
