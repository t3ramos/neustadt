import assert from 'node:assert/strict';
import test from 'node:test';
import { CITIZEN_LINES, CITIZEN_LINES_EN, CITIZEN_SPEECH_LIMITS, createCitizenSpeechSelector, type CitizenDialogueTopic } from '../src/citizen-dialogue.ts';
import { getLocale, setLocale } from '../src/i18n.ts';

const topics = Object.keys(CITIZEN_LINES) as CitizenDialogueTopic[];
test.beforeEach(() => setLocale('de'));
test.afterEach(() => setLocale('de'));

test('residents have hundreds of genuinely authored, unique, readable German remarks', () => {
  const allLines = Object.values(CITIZEN_LINES).flat();
  assert.ok(allLines.length >= 450, `Only ${allLines.length} authored lines`);
  assert.equal(new Set(allLines).size, allLines.length, 'Different contexts must not merely duplicate the same remarks');
  const normalized = allLines.map(line => line.toLocaleLowerCase('de-DE').replace(/[^\p{L}\p{N}]/gu, ''));
  assert.equal(new Set(normalized).size, allLines.length, 'Punctuation or capitalisation do not create a new remark');
  for (const topic of topics) {
    assert.ok(CITIZEN_LINES[topic].length >= 12, `${topic} needs enough observations for a real conversation pool`);
    for (const line of CITIZEN_LINES[topic]) {
      assert.ok(line.length >= 20 && line.length <= 115, `${topic}: unreadable bubble length ${line.length}: ${line}`);
      assert.equal(line.trim(), line);
      assert.doesNotMatch(line, /\n|\{\w+\}|\[\w+\]|TODO|Lorem ipsum/);
    }
  }
});

test('every authored observation has a distinct, readable English counterpart at the same index', () => {
  assert.deepEqual(Object.keys(CITIZEN_LINES_EN), topics);
  const germanLines = Object.values(CITIZEN_LINES).flat();
  const englishLines = Object.values(CITIZEN_LINES_EN).flat();
  assert.equal(englishLines.length, germanLines.length);
  assert.equal(englishLines.length, 494);
  const normalized = englishLines.map(line => line.toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]/gu, ''));
  assert.equal(new Set(normalized).size, englishLines.length, 'English observations must not collapse into repeated stock phrases');
  for (const topic of topics) {
    assert.equal(CITIZEN_LINES_EN[topic].length, CITIZEN_LINES[topic].length, `${topic} lost a translated observation`);
    CITIZEN_LINES_EN[topic].forEach((line, index) => {
      assert.notEqual(line, CITIZEN_LINES[topic][index], `${topic}[${index}] was left in German`);
      assert.ok(line.length >= 20 && line.length <= 115, `${topic}: unreadable English bubble length ${line.length}: ${line}`);
      assert.equal(line.trim(), line);
      assert.doesNotMatch(line, /\n|\{\w+\}|\[\w+\]|TODO|Lorem ipsum|[äöüÄÖÜß]/);
    });
  }
  assert.ok(CITIZEN_LINES_EN.night.every(line => !/lights|illumination|bright/i.test(line)), 'Night alone must not claim working lights');
  assert.ok(CITIZEN_LINES_EN.pets.every(line => !/\b(cat|dog|bark|barks|meow|meows)\b/i.test(line)), 'Generic pet observations must work for either cat or dog');
});

test('switching language uses the same observations and does not restart personal topic bags', () => {
  const selector = createCitizenSpeechSelector(714);
  const reference = createCitizenSpeechSelector(714);
  for (const topic of topics) {
    const seenIndexes = new Set<number>();
    for (let i = 0; i < CITIZEN_LINES[topic].length; i++) {
      setLocale(i % 2 ? 'en' : 'de');
      const expected = reference.pickPair(topic, 12);
      const line = selector.pick(topic, 12);
      assert.equal(line, expected[getLocale()]);
      const index = (CITIZEN_LINES[topic] as readonly string[]).indexOf(expected.de);
      assert.ok(!seenIndexes.has(index), `${topic} repeated an observation after changing language`);
      seenIndexes.add(index);
      assert.equal(expected.en, CITIZEN_LINES_EN[topic][index], `${topic} changed meaning between languages`);
    }
  }
});

test('pair and string selection each consume exactly one item of the shared deterministic sequence', () => {
  const mixed = createCitizenSpeechSelector(814);
  const reference = createCitizenSpeechSelector(814);
  for (let i = 0; i < 1400; i++) {
    const topic = topics[i % topics.length];
    const actorId = i % 17;
    setLocale(i % 4 < 2 ? 'de' : 'en');
    const expected = reference.pickPair(topic, actorId);
    if (i % 3) assert.equal(mixed.pick(topic, actorId), expected[getLocale()]);
    else assert.deepEqual(mixed.pickPair(topic, actorId), expected);
  }
  assert.deepEqual(mixed.getDebug(), reference.getDebug());
});

test('a retained speech pair can change display language without choosing or remembering a new line', () => {
  const selector = createCitizenSpeechSelector(22);
  const pair = selector.pickPair('nearMiss', 9);
  const memory = selector.getDebug();
  assert.ok((CITIZEN_LINES.nearMiss as readonly string[]).includes(pair[getLocale()]));
  setLocale('en');
  assert.ok((CITIZEN_LINES_EN.nearMiss as readonly string[]).includes(pair[getLocale()]));
  setLocale('de');
  assert.equal(pair[getLocale()], pair.de);
  assert.deepEqual(selector.getDebug(), memory);
});

test('each resident exhausts each contextual pool before reusing any line', () => {
  const selector = createCitizenSpeechSelector(123);
  for (const topic of topics) {
    const expected = new Set<string>(CITIZEN_LINES[topic]);
    for (let cycle = 0; cycle < 4; cycle++) {
      const actual = Array.from({ length: expected.size }, () => selector.pick(topic, 17));
      assert.deepEqual(new Set(actual), expected, `${topic}: cycle ${cycle} repeated or skipped an authored remark`);
    }
  }
});

test('seeded choices are reproducible and different seeds change the ordering', () => {
  const run = (seed: number) => {
    const selector = createCitizenSpeechSelector(seed);
    return Array.from({ length: 700 }, (_, i) => selector.pick(topics[i % topics.length], i % 13));
  };
  assert.deepEqual(run(98), run(98));
  assert.notDeepEqual(run(98), run(99));
  assert.deepEqual(run(Number.NaN), run(1));
  assert.deepEqual(run(0), run(0));
});

test('new neighbours do not all echo a recent line when fresh observations are available', () => {
  const selector = createCitizenSpeechSelector(20);
  const said: string[] = [];
  for (let actorId = 0; actorId < 120; actorId++) {
    const line = selector.pick('everyday', actorId);
    assert.ok(!said.slice(-CITIZEN_SPEECH_LIMITS.globalHistory).includes(line), 'Nearby residents formed a chorus');
    said.push(line);
  }
});

test('personal topic bags survive interleaved remarks and other residents', () => {
  const selector = createCitizenSpeechSelector(27);
  const held = new Set<string>();
  for (let i = 0; i < CITIZEN_LINES.held.length; i++) {
    const line = selector.pick('held', 7);
    assert.ok(!held.has(line), 'Another event or resident reset the actor bag');
    held.add(line);
    selector.pick('recovery', 7);
    selector.pick('held', 8);
    selector.pick('witness', 9);
  }
  assert.equal(held.size, CITIZEN_LINES.held.length);
});

test('the same actor never immediately repeats even when a contextual bag wraps', () => {
  const selector = createCitizenSpeechSelector(5);
  for (const topic of topics) {
    let previous = '';
    for (let i = 0; i < CITIZEN_LINES[topic].length * 8; i++) {
      const line = selector.pick(topic, 11);
      assert.notEqual(line, previous, `${topic} repeated at a bag boundary`);
      previous = line;
      selector.pick(topic, 12 + i % 6);
    }
  }
});

test('selection never invents a remark from a different event or setting', () => {
  const selector = createCitizenSpeechSelector(10);
  for (let i = 0; i < 2000; i++) {
    const topic = topics[i % topics.length];
    const line = selector.pick(topic, i % 23);
    assert.ok((CITIZEN_LINES[topic] as readonly string[]).includes(line));
  }
  assert.ok(CITIZEN_LINES.night.every(line => !/Lichter|Beleuchtung|hell/i.test(line)), 'Night alone must not claim working lights');
  assert.ok(CITIZEN_LINES.pets.every(line => !/bellt|miaut|Katze|Hund/.test(line)), 'Generic pet observations must work for either cat or dog');
});

test('speech memories stay bounded as many residents arrive and leave', () => {
  const selector = createCitizenSpeechSelector(4);
  for (let actorId = 0; actorId < 2500; actorId++) {
    for (const topic of topics) selector.pick(topic, actorId);
  }
  const debug = selector.getDebug();
  assert.equal(debug.actors, CITIZEN_SPEECH_LIMITS.actors);
  assert.ok(debug.topicBags <= CITIZEN_SPEECH_LIMITS.actors * topics.length);
  assert.ok(debug.actorHistory <= CITIZEN_SPEECH_LIMITS.actors * CITIZEN_SPEECH_LIMITS.actorHistory);
  assert.equal(debug.globalHistory, CITIZEN_SPEECH_LIMITS.globalHistory);
  selector.forget(2499);
  assert.equal(selector.getDebug().actors, CITIZEN_SPEECH_LIMITS.actors - 1);
  selector.clear();
  assert.deepEqual(selector.getDebug(), { actors: 0, topicBags: 0, actorHistory: 0, globalHistory: 0 });
});

test('frequently observed residents keep their bags during background population churn', () => {
  const selector = createCitizenSpeechSelector(49);
  const said = new Set<string>();
  for (let i = 0; i < CITIZEN_LINES.everyday.length; i++) {
    const line = selector.pick('everyday', 0);
    assert.ok(!said.has(line), 'The active resident lost their conversation memory');
    said.add(line);
    for (let j = 1; j <= 40; j++) selector.pick('traffic', i * 40 + j);
  }
});
