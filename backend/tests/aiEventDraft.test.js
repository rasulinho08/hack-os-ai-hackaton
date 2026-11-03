/**
 * AI event draft end to end against a running API whose MODEL_API_KEY is set
 * and META_AI_BASE_URL points at tests/fakeMetaAi.js (see e2e.test.js for how
 * to run). Skipped when the key is not set.
 *
 * Covers: organisers only; a short prompt never reaches the model; the plan
 * becomes a draft of the organiser's organisation, never published, with its
 * tracks, prizes and criteria; what the model gets wrong is left to the
 * template; a broken or failed answer creates nothing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session } = require('./helpers');
const { dbQuery, approvedBuyer } = require('./fixtures');

const AI_BASE = (process.env.META_AI_BASE_URL || 'http://127.0.0.1:5097').replace(/\/+$/, '');
const skip = !process.env.MODEL_API_KEY && 'MODEL_API_KEY is not set';
const ctx = {};

const aiLog = async () => (await fetch(`${AI_BASE}/__log`)).json();
const queueAnswer = (answer) => fetch(`${AI_BASE}/__answer`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(answer),
});
const draftCount = async (customerId) => (await dbQuery('SELECT COUNT(*)::int AS n FROM events WHERE customer_id = $1', [customerId])).rows[0].n;

const PROMPT = 'A 48-hour offline AI hackathon in Baku for 200 students, three tracks: energy, transport, waste.';

test('setup: an organiser', { skip }, async () => {
  ctx.buyer = await approvedBuyer('ai-starter');
});

test('AI is on, for organisers only', { skip }, async () => {
  const r = await ctx.buyer.session.get('/api/ai/status');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.enabled, true);
  const anon = new Session('ai-anon');
  assert.equal((await anon.get('/api/ai/status')).status, 401);
  assert.equal((await anon.post('/api/ai/event-draft', { prompt: PROMPT })).status, 401);
});

test('a prompt too short or too long never reaches the model', { skip }, async () => {
  const before = (await aiLog()).length;
  for (const prompt of ['short', 'x'.repeat(2001), 42]) {
    const r = await ctx.buyer.session.post('/api/ai/event-draft', { prompt });
    assert.equal(r.status, 400, r.text);
    assert.equal(r.json.code, 'VALIDATION_ERROR');
  }
  assert.equal((await aiLog()).length, before);
});

test('the plan becomes a draft of the organisation, never published', { skip }, async () => {
  const r = await ctx.buyer.session.post('/api/ai/event-draft', { prompt: PROMPT, language: 'en', timezone: 'Asia/Baku' });
  assert.equal(r.status, 201, r.text);
  const { event, tracks, prizes, criteria, ai } = r.data;
  assert.equal(event.name, 'Baku Green AI Hackathon');
  assert.equal(event.status, 'draft');
  assert.equal(event.is_published, false);
  assert.equal(Number(event.customer_id), Number(ctx.buyer.customerId));
  assert.equal(event.city, 'Baku');
  assert.equal(event.format, 'offline');
  assert.equal(event.max_participants, 200);
  assert.equal(event.team_size_limit, 4);
  assert.equal(event.min_team_size, 2);
  assert.ok(new Date(event.start_date) > new Date(Date.now() + 29 * 24 * 3600 * 1000));
  assert.deepEqual(tracks.map((t) => t.name), ['Energy', 'Transport', 'Waste']);
  assert.deepEqual(prizes.filter((p) => p.kind === 'place').map((p) => [p.position, p.value]), [[1, '3000 AZN'], [2, '1500 AZN'], [3, '500 AZN']]);
  assert.equal(prizes.filter((p) => p.kind === 'special').length, 1);
  assert.deepEqual(criteria.map((c) => [c.name, Number(c.weight)]), [['Impact', 2], ['Technical execution', 1.5], ['Presentation', 1]]);
  assert.deepEqual(ai.skipped, []);
  ctx.eventId = event.id;

  const call = (await aiLog()).at(-1);
  assert.equal(call.auth, true);
  assert.match(call.messages[0].content, /English/);
  assert.equal(call.messages[1].content, PROMPT);

  // The organiser keeps working on it in the builder.
  const b = await ctx.buyer.session.get(`/api/events/${ctx.eventId}/builder`);
  assert.equal(b.status, 200, b.text);
});

test('what the model gets wrong is left to the template', { skip }, async () => {
  await queueAnswer({
    content: 'Here is your event:\n```json\n' + JSON.stringify({
      name: 'Past Dates Jam',
      start_date: '2020-01-01T10:00',
      end_date: '2020-01-02T10:00',
      format: 'metaverse',
      criteria: [{ name: 'Fun', weight: 99 }],
      prizes: [{ kind: 'track', name: 'Track winner' }],
    }) + '\n```',
  });
  const r = await ctx.buyer.session.post('/api/ai/event-draft', { prompt: 'A small game jam next month for our club.' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.event.name, 'Past Dates Jam');
  assert.ok(new Date(r.data.event.start_date) > new Date(), 'the template keeps a future start');
  assert.deepEqual(r.data.criteria.map((c) => [c.name, Number(c.weight)]), [['Fun', 1]]);
  assert.deepEqual(r.data.prizes.map((p) => [p.kind, p.position]), [['place', 1]]);
});

test('a broken or failed answer creates nothing', { skip }, async () => {
  const before = await draftCount(ctx.buyer.customerId);
  await queueAnswer({ content: 'I cannot help with that.' });
  let r = await ctx.buyer.session.post('/api/ai/event-draft', { prompt: PROMPT });
  assert.equal(r.status, 502, r.text);
  assert.equal(r.json.code, 'AI_BAD_OUTPUT');

  await queueAnswer({ content: JSON.stringify({ tagline: 'no name' }) });
  r = await ctx.buyer.session.post('/api/ai/event-draft', { prompt: PROMPT });
  assert.equal(r.status, 502, r.text);
  assert.equal(r.json.code, 'AI_BAD_OUTPUT');

  await queueAnswer({ status: 500 });
  r = await ctx.buyer.session.post('/api/ai/event-draft', { prompt: PROMPT });
  assert.equal(r.status, 502, r.text);
  assert.equal(r.json.code, 'AI_UPSTREAM_ERROR');

  await queueAnswer({ status: 429 });
  r = await ctx.buyer.session.post('/api/ai/event-draft', { prompt: PROMPT });
  assert.equal(r.status, 429, r.text);
  assert.equal(r.json.code, 'AI_RATE_LIMITED');

  assert.equal(await draftCount(ctx.buyer.customerId), before);
});

test('another organisation cannot open the draft', { skip }, async () => {
  const other = await approvedBuyer('ai-other');
  const r = await other.session.get(`/api/events/${ctx.eventId}/builder`);
  assert.ok([403, 404].includes(r.status), r.text);
});
