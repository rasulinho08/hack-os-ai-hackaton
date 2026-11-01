/**
 * Automatic announcements: when each is due, the window after which it is
 * no longer sent, and its words in the event's language.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { due, render, TEXT } = require('../src/services/autoAnnouncements');

const H = 3600e3;
const NOW = Date.UTC(2026, 10, 1, 10, 0);
const ev = (o = {}) => ({
  name: 'Bakı Hackathon', language: 'az', timezone: 'Asia/Baku',
  registration_end: new Date(NOW + 12 * H).toISOString(),
  start_date: new Date(NOW + 20 * 60e3).toISOString(),
  submission_deadline: new Date(NOW + 30 * 60e3).toISOString(),
  end_date: new Date(NOW + 48 * H).toISOString(),
  demo_day: new Date(NOW + 50 * 60e3).toISOString(),
  ...o,
});
const ALL = Object.fromEntries(Object.keys(TEXT.en).map((k) => [k, true]));

test('due: inside the window only, and only what is switched on', () => {
  const keys = due(ev(), ALL, NOW);
  assert.ok(keys.includes('reg24'), 'registration closes within 24 h');
  assert.ok(keys.includes('start30'), 'start in 20 min: inside the 30-minute window');
  assert.ok(keys.includes('sub1'), 'deadline in 30 min');
  assert.ok(keys.includes('pres1'), 'presentations in 50 min');
  assert.ok(!keys.includes('started'), 'not started yet');
  assert.ok(!keys.includes('results') && !keys.includes('certs'), 'not on the clock');
  assert.deepEqual(due(ev(), { reg24: true }, NOW), ['reg24']);
  assert.deepEqual(due(ev(), {}, NOW), []);
});

test('due: a late server does not send what is no longer true', () => {
  const started = ev({ start_date: new Date(NOW - 3 * H).toISOString() });
  assert.ok(!due(started, ALL, NOW).includes('start30'), 'start passed: no "starts in 30 minutes"');
  assert.ok(!due(started, ALL, NOW).includes('started'), 'more than 2 h late: not sent');
  const justStarted = ev({ start_date: new Date(NOW - 10 * 60e3).toISOString() });
  assert.ok(due(justStarted, ALL, NOW).includes('started'));
});

test('render: event language, name and times on the event clock', () => {
  const az = render('sub1', ev());
  assert.equal(az.title, 'Təqdimetməyə 1 saat qaldı');
  assert.ok(az.body.includes('Bakı Hackathon'));
  assert.ok(/\d{2}:\d{2}/.test(az.body), 'deadline time included');
  assert.equal(az.urgent, true);
  assert.equal(az.email, true);
  const ru = render('started', ev({ language: 'ru' }));
  assert.equal(ru.title, 'Хакатон начался');
  assert.equal(render('reg24', ev({ language: 'xx' })).title, 'Registration closes in 24 hours', 'unknown language → English');
});

test('every announcement exists in all three languages', () => {
  for (const lang of ['az', 'en', 'ru']) assert.deepEqual(Object.keys(TEXT[lang]).sort(), Object.keys(TEXT.en).sort());
});

test('events from before automatic announcements start with them switched off', () => {
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'db', 'migrations', '0014_jobs_and_announcements.sql'), 'utf8');
  const update = sql.match(/UPDATE events\s+SET comms_config = jsonb_set[\s\S]*?;/);
  assert.ok(update, 'the migration switches them off');
  for (const key of Object.keys(require('../src/services/autoAnnouncements').TIMING)) assert.match(update[0], new RegExp(`"${key}":false`));
  assert.match(update[0], /WHERE NOT \(COALESCE\(comms_config, '\{\}'::jsonb\) \? 'auto'\)/, 'only events that never chose');
});

test('times read naturally in each language (no English "at" inside Azerbaijani)', () => {
  const { formatWhen } = require('../src/services/autoAnnouncements');
  // 23:17 UTC on 20 October is 03:17 on 21 October in Baku.
  const at = '2026-10-20T23:17:00Z';
  assert.equal(formatWhen(at, 'Asia/Baku', 'az'), '21 oktyabr, 03:17');
  assert.equal(formatWhen(at, 'Asia/Baku', 'en'), '21 October at 03:17');
  assert.equal(formatWhen(at, 'Asia/Baku', 'ru'), '21 октября в 03:17');
  const az = render('sub24', ev({ submission_deadline: at, end_date: at }));
  assert.ok(az.body.includes('21 oktyabr, 03:17 tarixinədək'), az.body);
  assert.ok(!/\bat\b/.test(az.body), az.body);
});
