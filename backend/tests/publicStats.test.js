/**
 * The home page's figures (Phase 7): counted from the database, published
 * events only, kept ten minutes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session } = require('./helpers');
const { dbQuery } = require('./fixtures');

const RULE = `WITH ev AS (SELECT id FROM events
                WHERE is_published = true AND LOWER(TRIM(COALESCE(status::text, ''))) <> 'draft')
  SELECT (SELECT COUNT(*) FROM ev)::int AS events,
         (SELECT COUNT(*) FROM participants p JOIN ev ON ev.id = p.event_id)::int AS participants,
         (SELECT COUNT(*) FROM teams t JOIN ev ON ev.id = t.event_id)::int AS teams,
         (SELECT COUNT(*) FROM submissions s JOIN ev ON ev.id = s.event_id)::int AS projects`;

test('anyone reads the figures; the answer is cached for ten minutes', async () => {
  const anon = new Session('stats');
  const first = await anon.get('/api/public/stats');
  assert.equal(first.status, 200, first.text);
  for (const k of ['events', 'participants', 'teams', 'projects']) {
    assert.ok(Number.isInteger(first.data[k]) && first.data[k] >= 0, k);
  }
  assert.ok(!Number.isNaN(Date.parse(first.data.countedAt)));
  const again = await anon.get('/api/public/stats');
  assert.equal(again.data.countedAt, first.data.countedAt, 'the same counting, from the cache');
  const raw = await fetch(`${process.env.API_URL || 'http://localhost:5000'}/api/public/stats`);
  assert.match(raw.headers.get('cache-control') || '', /public, max-age=600/);
});

test('published events count, drafts and unpublished ones do not', async () => {
  const stats = require('../src/services/publicStats.service');
  assert.equal(stats.TTL_MS, 10 * 60 * 1000);
  // Other suites create and delete events at the same time: compare with the
  // rule counted right before and right after, with a little slack.
  const before = (await dbQuery(RULE)).rows[0];
  const fresh = await stats.count();
  const after = (await dbQuery(RULE)).rows[0];
  for (const k of ['events', 'participants', 'teams', 'projects']) {
    const lo = Math.min(before[k], after[k]) - 5;
    const hi = Math.max(before[k], after[k]) + 5;
    assert.ok(fresh[k] >= lo && fresh[k] <= hi, `${k}: ${fresh[k]} not within ${lo}..${hi}`);
  }
  const all = (await dbQuery('SELECT COUNT(*)::int AS n FROM events')).rows[0].n;
  const hidden = (await dbQuery(
    "SELECT COUNT(*)::int AS n FROM events WHERE is_published = false OR LOWER(TRIM(COALESCE(status::text, ''))) = 'draft'",
  )).rows[0].n;
  if (hidden > 0) assert.ok(fresh.events < all, 'unpublished events are left out');
});
