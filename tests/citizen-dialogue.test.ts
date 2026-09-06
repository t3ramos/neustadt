import assert from 'node:assert/strict';
import test from 'node:test';
import { CITIZEN_LINES, CITIZEN_SPEECH_LIMITS, createCitizenSpeechSelector, type CitizenDialogueTopic } from '../src/citizen-dialogue.ts';

const topics = Object.keys(CITIZEN_LINES) as CitizenDialogueTopic[];

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
