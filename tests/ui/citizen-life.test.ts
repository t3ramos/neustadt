import assert from 'node:assert/strict';
import test from 'node:test';
import { renderCitizenLifeView } from '../../src/ui/views/citizen-life';
import type { CitizenLifeSnapshot } from '../../src/domain/citizen-life';
import { setLocale } from '../../src/i18n/index';

const snapshot = (patch: Partial<CitizenLifeSnapshot> = {}): CitizenLifeSnapshot => ({
  total: 24,
  counts: { work: 8, home: 2, leisure: 4, social: 0, wandering: 10 },
  event: null,
  cooldownSeconds: 0,
  ...patch,
});
const eventButton = (html: string, kind: string) =>
  html.match(new RegExp(`<button[^>]*data-citizen-event="${kind}"[^>]*>`))?.[0] ?? '';

test('paused drawer requires explicit resume but retains event focus and stop controls', () => {
  const state = snapshot({
    event: { kind: 'gathering', x: 1, z: 2, invited: 3, arrived: 1, remaining: 40 },
  });
  const original = structuredClone(state);
  const html = renderCitizenLifeView(state, true);
  assert.match(html, /Setze die Simulation fort/);
  assert.match(html, /type="button"[^>]*data-citizen-resume/);
  assert.ok(eventButton(html, 'gathering').includes('disabled'));
  assert.match(html, /data-citizen-event-focus/);
  assert.match(html, /data-citizen-event-stop/);
  assert.deepEqual(state, original, 'rendering cannot advance or alter simulation state');
  assert.ok(!renderCitizenLifeView(snapshot()).includes('data-citizen-resume'));
});

test('city-life drawer renders localized live routines and all available sandbox entry points', () => {
  try {
    for (const locale of ['de', 'en'] as const) {
      setLocale(locale);
      const html = renderCitizenLifeView(snapshot());
      assert.ok(html.includes(locale === 'de' ? 'Stadtleben' : 'City life'));
      assert.ok(html.includes(locale === 'de' ? 'Sichtbare Bewohner' : 'Visible residents'));
      assert.ok(
        html.includes(
          locale === 'de' ? 'Veranstaltungen nutzen vorhandene Wege' : 'Events use existing paths',
        ),
      );
      assert.ok(html.includes(locale === 'de' ? 'Arbeitsweg' : 'Work routine'));
      assert.match(html, /<dd>8<\/dd>/);
      assert.ok(eventButton(html, 'gathering'));
      assert.ok(eventButton(html, 'festival'));
      assert.ok(!eventButton(html, 'gathering').includes('disabled'));
      assert.match(html, /type="button"[^>]*data-citizen-grab/);
      assert.ok(!html.includes('data-citizen-event-stop'));
      assert.ok(
        html.includes(
          locale === 'de' ? 'ohne Geldkosten oder Belohnungen' : 'no money cost or rewards',
        ),
      );
      assert.ok(html.includes(locale === 'de' ? 'laufen zum Ziel' : 'walk to the destination'));
    }
  } finally {
    setLocale('de');
  }
});

test('active event shows real attendance, remaining simulation time and focus/stop buttons', () => {
  const html = renderCitizenLifeView(
    snapshot({
      event: {
        kind: 'festival',
        invited: 12,
        arrived: 5,
        remaining: 83.2,
        x: 12,
        z: 13,
      },
    }),
  );
  assert.match(html, /Stadtfest/);
  assert.match(html, /max="12" value="5"/);
  assert.match(html, /1:24/);
  assert.match(html, /data-citizen-event-focus/);
  assert.match(html, /data-citizen-event-stop/);
  assert.ok(eventButton(html, 'gathering').includes('disabled'));
  assert.ok(eventButton(html, 'festival').includes('disabled'));
  assert.match(html, /aria-live="polite"/);
});

test('cooldown and empty city explain disabled invitations', () => {
  for (const [patch, expected] of [
    [{ cooldownSeconds: 30 }, '0:30'],
    [{ total: 0 }, 'Sobald Bewohner unterwegs sind'],
  ] as const) {
    const html = renderCitizenLifeView(snapshot(patch));
    assert.ok(eventButton(html, 'gathering').includes('disabled'));
    assert.ok(html.includes(expected));
    assert.match(html, /aria-describedby="citizen-event-availability"/);
  }
});

test('snapshot strings are escaped and invalid counts cannot corrupt progress markup', () => {
  const html = renderCitizenLifeView(
    snapshot({
      total: Number.NaN,
      counts: {
        work: -10,
        home: 0,
        leisure: 0,
        social: 0,
        wandering: 0,
        '<img src=x onerror="alert(1)">': 2,
      } as CitizenLifeSnapshot['counts'],
      event: {
        kind: 'gathering',
        invited: 0,
        arrived: Infinity,
        remaining: -4,
        x: 12,
        z: 13,
      },
    }),
  );
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /max="1" value="0"/);
  assert.match(html, /0:00/);
  assert.ok(!html.includes('NaN'));
  assert.ok(!html.includes('Infinity'));
});
