/**
 * Unit tests for the builder's pure parts: field reading, the timeline, the
 * checklist, templates and time zones, file recognition. No server needed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readBuilderFields, reconcileTimeline } = require('../src/services/eventBuilderInput');
const { buildChecklist, isReady } = require('../src/services/eventChecklist');
const { buildTemplate, slugify, codeFrom, zonedTime } = require('../src/services/eventTemplates');
const { sniff, cleanName } = require('../src/services/file.service');

test('only the fields sent are read, each checked', () => {
  const { values, errors } = readBuilderFields({ tagline: '  Build  ', brandColor: '#1F6FEB', maxParticipants: '' });
  assert.deepEqual(errors, []);
  assert.deepEqual(values, { tagline: 'Build', brand_color: '#1f6feb', max_participants: null });
  const bad = readBuilderFields({ online_url: 'javascript:alert(1)', country: 'Azerbaijan', faq: 'x' });
  assert.deepEqual(bad.errors.map((e) => e.field).sort(), ['country', 'faq', 'online_url']);
});

test('nested settings merge over what is stored', () => {
  const existing = { judging_config: { blind: true, assignment: 'track' } };
  const { values } = readBuilderFields({ judging_config: { judgesPerTeam: 2 } }, existing);
  assert.equal(values.judging_config.blind, true);
  assert.equal(values.judging_config.assignment, 'track');
  assert.equal(values.judging_config.judgesPerTeam, 2);
  assert.equal(values.judging_config.resultsVisibility, 'own_and_winners');
});

test('a submission must ask for something', () => {
  const { errors } = readBuilderFields({
    submission_config: { fields: { repo: 'off', demo: 'off', slides: 'off', video: 'off', summary: 'off', tech: 'off' }, files: { enabled: false } },
  });
  assert.equal(errors[0].field, 'submission_config');
});

test('moving the event pulls the dates the organiser did not touch', () => {
  const row = { start_date: '2026-11-10T06:00:00Z', end_date: '2026-11-11T06:00:00Z', team_deadline: '2026-11-20T06:00:00Z', results_at: '2026-11-21T06:00:00Z' };
  const moved = reconcileTimeline(row, new Set(['end_date']));
  assert.deepEqual(moved.errors, []);
  assert.equal(moved.pulled.team_deadline, row.end_date);
  const own = reconcileTimeline(row, new Set(['team_deadline']));
  assert.equal(own.errors[0].field, 'team_deadline', 'a date set out of order is refused');
});

test('impossible schedules are on the checklist, each with the date it clashes with', () => {
  const at = (h) => new Date(Date.UTC(2027, 2, 10, 6) + h * 3600e3).toISOString();
  const ok = {
    registration_start: at(-240), registration_end: at(-24), team_deadline: at(0),
    start_date: at(0), end_date: at(24), submission_deadline: at(22),
    judging_start: at(23), judging_end: at(26), demo_day: at(24), results_at: at(27),
  };
  const problems = (row) => buildChecklist(row, { modules: new Set(), counts: { fields: {} } })
    .filter((i) => i.code === 'timeline_order')
    .map((i) => [i.params.field, i.params.rel, i.params.other]);
  assert.deepEqual(problems(ok), [], 'a sound schedule has no timeline problem');

  // Projects due before the event starts.
  assert.deepEqual(problems({ ...ok, submission_deadline: at(-5) }), [['submission_deadline', 'before', 'start_date']]);
  // Results and demo day before projects are in. Judging may start earlier
  // (rolling judging), not before the event starts.
  assert.deepEqual(
    problems({ ...ok, judging_start: at(10), judging_end: at(12), demo_day: at(9), results_at: at(13) }).sort(),
    [['demo_day', 'before', 'submission_deadline'], ['results_at', 'before', 'submission_deadline']],
  );
  assert.deepEqual(problems({ ...ok, judging_start: at(-2) }), [['judging_start', 'before', 'start_date']]);
  // No deadline: submissions close at the end of the event.
  assert.deepEqual(problems({ ...ok, submission_deadline: null, results_at: at(20), judging_start: null, judging_end: null }), [['results_at', 'before', 'end_date']]);
  // Registration closing after the event ends; an end before its start.
  assert.deepEqual(problems({ ...ok, registration_end: at(30) }), [['registration_end', 'after', 'end_date']]);
  assert.deepEqual(problems({ ...ok, registration_start: at(-10), registration_end: at(-20) }), [['registration_end', 'before', 'registration_start']]);
  assert.deepEqual(problems({ ...ok, judging_end: at(22.5) }), [['judging_end', 'before', 'judging_start']]);
  const ended = problems({ ...ok, end_date: at(-1), submission_deadline: null, judging_start: null, judging_end: null, demo_day: null, results_at: null });
  assert.ok(ended.some(([f, rel, o]) => f === 'end_date' && rel === 'before' && o === 'start_date'), JSON.stringify(ended));
});

test('a date typed out of order is refused; a date only dragged along is pulled', () => {
  const row = { start_date: '2027-03-10T06:00:00Z', end_date: '2027-03-11T06:00:00Z', submission_deadline: '2027-03-11T04:00:00Z', results_at: '2027-03-11T08:00:00Z' };
  const typed = reconcileTimeline({ ...row, submission_deadline: '2027-03-09T06:00:00Z' }, new Set(['submission_deadline']));
  assert.deepEqual(typed.errors.map((e) => [e.field, e.code, e.other]), [['submission_deadline', 'TIMELINE_BEFORE', 'start_date']]);
  const early = reconcileTimeline({ ...row, results_at: '2027-03-10T12:00:00Z' }, new Set(['results_at']));
  assert.deepEqual(early.errors.map((e) => [e.field, e.other]), [['results_at', 'submission_deadline']]);
  // The organiser moves the deadline later: results that were after it follow.
  const moved = reconcileTimeline({ ...row, submission_deadline: '2027-03-11T06:00:00Z', results_at: '2027-03-11T05:00:00Z' }, new Set(['submission_deadline']));
  assert.deepEqual(moved.errors, []);
  assert.equal(moved.pulled.results_at, '2027-03-11T06:00:00Z');
});

test('the checklist blocks only on errors', () => {
  const e = { name: 'Hack', tagline: null, format: 'online', start_date: new Date(Date.now() + 864e5), end_date: new Date(Date.now() + 2 * 864e5), registration_start: new Date(), registration_end: new Date(Date.now() + 864e5 / 2), registration_mode: 'solo', team_size_limit: 1, eligibility: {}, faq: [] };
  const items = buildChecklist(e, { modules: new Set(['judging']), participantLimit: null, counts: { criteria: 1, prizes: 1, judges: 1, fields: {} } });
  assert.equal(isReady(items), false);
  assert.ok(items.some((i) => i.code === 'tagline_missing'));
  const fixed = buildChecklist({ ...e, tagline: 'x', online_url: 'https://meet.example.com' }, { modules: new Set(), participantLimit: null, counts: { criteria: 1, prizes: 1, judges: 1, fields: {} } });
  assert.equal(isReady(fixed), true, JSON.stringify(fixed));
});

test('templates start at 10:00 in the event\'s own time zone', () => {
  const t = buildTemplate('hackathon24', { timeZone: 'Asia/Baku', language: 'az', now: new Date('2026-10-18T12:00:00Z') });
  assert.equal(t.event.start_date.toISOString(), '2026-11-17T06:00:00.000Z', '10:00 in Baku is 06:00 UTC');
  assert.equal(t.event.end_date.getTime() - t.event.start_date.getTime(), 24 * 3600 * 1000);
  assert.equal(t.criteria.length, 4);
  assert.equal(t.prizes[0].name, '1-ci yer');
  const ny = zonedTime(2026, 3, 8, 10, 0, 'America/New_York');
  assert.equal(ny.toISOString(), '2026-03-08T14:00:00.000Z', 'daylight saving is respected');
});

test('slugs and codes from Azerbaijani and Russian names', () => {
  assert.equal(slugify('Bakı Ağ Şəhər Hackathon 2026'), 'baki-ag-seher-hackathon-2026');
  assert.equal(slugify('Хакатон Баку'), 'khakaton-baku');
  assert.equal(codeFrom('Gəncə İdeyalar'), 'GENCEIDEYALA');
});

test('files are recognised by their bytes', () => {
  assert.equal(sniff(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')), 'png');
  assert.equal(sniff(Buffer.from('%PDF-1.7\n%%%%%%%%%%')), 'pdf');
  assert.equal(sniff(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(cleanName('..%2F..%2Fetc%2Fpasswd', 'pdf'), 'passwd.pdf');
  assert.equal(cleanName('Mənim CV.docx', 'pdf'), 'Mənim CV.pdf');
});
