/**
 * Unit tests for the AI event draft's pure parts: reading the model's answer
 * and reducing its plan to what the builder accepts. No server, no model.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractJson } = require('../src/services/metaAi');
const { normalizePlan, systemPrompt } = require('../src/services/aiEventDraft');

const NOW = new Date('2026-10-27T08:00:00Z');
const ctx = { timeZone: 'Asia/Baku', language: 'en', now: NOW };

test('the JSON is found in a bare answer, a fence or prose around it', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Here:\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('Sure! {"a":3} Hope it helps.'), { a: 3 });
  assert.equal(extractJson('no json here'), null);
  assert.equal(extractJson('[1,2]'), null);
  assert.equal(extractJson(''), null);
});

test('dates are the event\'s local time and go in together', () => {
  const plan = normalizePlan({
    name: 'Test', start_date: '2026-11-20T10:00', end_date: '2026-11-22T18:00',
    registration_end: '2026-11-15T23:00', submission_deadline: '2026-11-22T08:00',
  }, ctx);
  // Baku is UTC+4.
  assert.equal(plan.fields.start_date, '2026-11-20T06:00:00.000Z');
  assert.equal(plan.fields.end_date, '2026-11-22T14:00:00.000Z');
  assert.equal(plan.fields.registration_end, '2026-11-15T19:00:00.000Z');

  const backwards = normalizePlan({ name: 'Test', start_date: '2026-11-22T10:00', end_date: '2026-11-20T10:00' }, ctx);
  assert.equal(backwards.fields.start_date, undefined);
  const past = normalizePlan({ name: 'Test', start_date: '2025-01-01T10:00', end_date: '2025-01-02T10:00' }, ctx);
  assert.equal(past.fields.start_date, undefined);
  const far = normalizePlan({ name: 'Test', start_date: '2030-01-01', end_date: '2030-01-02' }, ctx);
  assert.equal(far.fields.start_date, undefined);
  const nonsense = normalizePlan({ name: 'Test', start_date: 'next friday', end_date: '2026-13-40' }, ctx);
  assert.equal(nonsense.fields.start_date, undefined);
});

test('unknown values and keys are dropped, numbers kept in range', () => {
  const plan = normalizePlan({
    name: '  Big   Event  ', category: 'Hackathon', format: 'metaverse', template: 'nope',
    max_participants: -5, min_team_size: 6, team_size_limit: 4, is_published: true, status: 'upcoming',
  }, ctx);
  assert.equal(plan.draft.name, 'Big Event');
  assert.equal(plan.draft.template, 'hackathon24');
  assert.equal(plan.fields.category, 'hackathon');
  assert.equal(plan.fields.format, undefined);
  assert.equal(plan.fields.max_participants, undefined);
  assert.equal(plan.fields.team_size_limit, 4);
  assert.equal(plan.fields.min_team_size, 4);
  assert.equal('is_published' in plan.fields, false);
  assert.equal('status' in plan.fields, false);
});

test('lists: places numbered in order, no track prizes, criteria in range, no duplicates', () => {
  const plan = normalizePlan({
    name: 'Test',
    tracks: [{ name: 'AI' }, { name: 'ai' }, { description: 'no name' }, 'text'],
    prizes: [
      { kind: 'place', name: 'Gold' }, { kind: 'track', name: 'Best AI' },
      { kind: 'special', name: 'Jury pick' }, { kind: 'place', name: 'Silver' },
    ],
    criteria: [
      { name: 'Impact', weight: 99, max_score: 1000 },
      { name: 'Impact', weight: 2 },
      { name: 'Demo', weight: '1.5', max_score: 5 },
    ],
    faq: [{ q: 'Who?', a: 'Anyone.' }, { q: 'No answer' }],
  }, ctx);
  assert.deepEqual(plan.tracks.map((t) => t.name), ['AI']);
  assert.deepEqual(plan.prizes.map((p) => [p.kind, p.position, p.name]), [
    ['place', 1, 'Gold'], ['place', 2, 'Best AI'], ['special', null, 'Jury pick'], ['place', 3, 'Silver'],
  ]);
  assert.deepEqual(plan.criteria.map((c) => [c.name, c.weight, c.max_score]), [['Impact', 1, 10], ['Demo', 1.5, 5]]);
  assert.deepEqual(plan.fields.faq, [{ q: 'Who?', a: 'Anyone.' }]);
});

test('the prompt names the language, the zone and today', () => {
  const s = systemPrompt({ language: 'az', timeZone: 'Asia/Baku', today: '2026-10-27' });
  assert.match(s, /Azerbaijani/);
  assert.match(s, /Asia\/Baku/);
  assert.match(s, /2026-10-27/);
});
