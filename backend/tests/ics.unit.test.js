/**
 * The iCalendar writer and the calendar entries of an event (no database).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { calendar, stamp, text, fold } = require('../src/utils/ics');
const { entriesOf } = require('../src/services/calendar.service');

test('times are UTC stamps', () => {
  assert.equal(stamp('2026-10-19T09:05:03.000Z'), '20261019T090503Z');
  assert.equal(stamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))), '20260102T030405Z');
  assert.equal(stamp('nonsense'), null);
});

test('text is escaped', () => {
  assert.equal(text('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
});

test('long lines fold at 75 octets without breaking a character', () => {
  const line = `SUMMARY:${'ə'.repeat(80)}`;
  const folded = fold(line);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  for (const [i, p] of parts.entries()) {
    assert.ok(Buffer.byteLength(p, 'utf8') <= 75, `line ${i} is ${Buffer.byteLength(p, 'utf8')} octets`);
    if (i > 0) assert.equal(p[0], ' ');
  }
  assert.equal(parts.map((p, i) => (i ? p.slice(1) : p)).join(''), line, 'unfolding gives the line back');
  assert.ok(!folded.includes('�'), 'no character was cut in half');
});

test('a calendar has its events, a moment lasts a quarter of an hour', () => {
  const ics = calendar({
    name: 'Bakı, AI',
    events: [
      { uid: 'a@x', start: '2026-11-01T08:00:00Z', end: '2026-11-02T16:00:00Z', summary: 'Hack', location: 'ADA, Bakı' },
      { uid: 'b@x', start: '2026-10-30T20:00:00Z', summary: 'Deadline' },
      { uid: 'c@x', start: 'bad', summary: 'Skipped' },
    ],
  });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 2);
  assert.match(ics, /X-WR-CALNAME:Bakı\\, AI/);
  assert.match(ics, /DTSTART:20261030T200000Z\r\nDTEND:20261030T201500Z/);
  assert.match(ics, /LOCATION:ADA\\, Bakı/);
  assert.ok(!/Skipped/.test(ics));
});

const event = {
  id: 7, name: 'AI Hack', slug: 'ai-hack', language: 'az', format: 'hybrid', venue_name: 'ADA', city: 'Bakı',
  online_url: 'https://meet.example/room', start_date: '2026-11-01T08:00:00Z', end_date: '2026-11-02T16:00:00Z',
  registration_end: '2026-10-25T20:00:00Z', team_deadline: '2026-10-31T20:00:00Z', submission_deadline: '2026-11-02T12:00:00Z',
  judging_start: '2026-11-02T12:00:00Z', judging_end: '2026-11-02T14:00:00Z', demo_day: null, results_at: '2026-11-02T16:00:00Z',
};
const parts = (list) => list.map((e) => e.uid.replace(/^hackos-event-7-|@.*$/g, ''));

test('the public calendar has the public dates and no room link', () => {
  const list = entriesOf(event, { kind: 'public', withLink: false });
  assert.deepEqual(parts(list), ['main', 'registration-end', 'team-deadline', 'submission-deadline', 'results']);
  assert.ok(list.every((e) => !String(e.description).includes('meet.example')));
  assert.equal(list[0].location, 'ADA, Bakı / Onlayn', 'in the event\'s language');
  assert.equal(list[1].summary, 'Qeydiyyat bağlanır — AI Hack');
});

test('each reader gets what concerns them', () => {
  assert.deepEqual(parts(entriesOf(event, { kind: 'judge', withLink: true })), ['main', 'judging', 'results']);
  assert.deepEqual(parts(entriesOf(event, { kind: 'mentor', withLink: true })), ['main', 'submission-deadline', 'results']);
  const mine = entriesOf(event, { kind: 'participant', withLink: true, slot: { scheduled_at: '2026-11-02T14:30:00Z', duration: 5 } });
  assert.deepEqual(parts(mine), ['main', 'team-deadline', 'submission-deadline', 'results', 'presentation']);
  const slot = mine.find((e) => e.uid.includes('presentation'));
  assert.equal(new Date(slot.end).toISOString(), '2026-11-02T14:35:00.000Z');
  assert.ok(String(mine[0].description).includes('https://meet.example/room'), 'let in: the room link');
  assert.ok(!String(entriesOf(event, { kind: 'participant', withLink: false })[0].description).includes('meet.example'));
});
