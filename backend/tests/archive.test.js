/**
 * Archived events and the "would you recommend it" question, end to end.
 *
 * Covers: NPS (opens when the event ends, admitted participants only, one
 * answer each that can change, the organiser's score without names, kept
 * apart from written feedback); the event's ZIP export (every CSV, project
 * files, spreadsheet formulas defused, organisers only); archiving by hand
 * and every kind of change refused afterwards — to organisers, judges and
 * participants alike — while reading, exporting and sending certificates
 * again still work, without telling other organisations the event exists;
 * signing up for an archived event; bringing it back; deleting an archived
 * event; and archiving by itself 14 days after the end, but not drafts and
 * not an event its organiser brought back.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { dbQuery, approvedBuyer } = require('./fixtures');
const { unzip } = require('./unzip');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const HOUR = 3600e3;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const admin = new Session('ar-admin');
const anon = new Session('ar-anon');
const ctx = { people: {} };

test.after(async () => {
  // The in-process service calls below opened the API's own pool.
  await require('../src/config/db').pool.end();
});

async function userIdOf(mail) {
  return (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [mail])).rows[0].id;
}

async function register(ev, tag, name, { approve = true } = {}) {
  const s = new Session(tag);
  const r = await s.post(`/api/public/events/${ev.slug}/register`, {
    account: { fullName: name, email: email(tag), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  const userId = await userIdOf(email(tag));
  const pid = (await dbQuery('SELECT id FROM participants WHERE event_id = $1 AND user_id = $2', [ev.id, userId])).rows[0].id;
  if (approve) {
    const a = await admin.patch(`/api/events/${ev.id}/participants/${pid}`, { status: 'approved' });
    assert.equal(a.status, 200, a.text);
  }
  return { s, userId, pid, name };
}

async function newEvent(tag, extra = {}) {
  const r = await admin.post('/api/events', {
    event_code: `${tag}${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
    name: `${tag} ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true, ...extra,
  });
  assert.equal(r.status, 201, r.text);
  return r.data;
}

test('setup: an event with a team, a project with a file, a judge and a score', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  ctx.ev = await newEvent('AR');
  let r = await admin.put(`/api/events/${ctx.ev.id}/builder/criteria`, { items: [{ cid: 'q', name: 'Quality', maxScore: 10, weight: 1 }] });
  assert.equal(r.status, 200, r.text);
  ctx.crit = r.data.idsByCid.q;
  r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { submission_config: { files: { enabled: true, maxMb: 2, types: ['pdf'] } } });
  assert.equal(r.status, 200, r.text);

  ctx.people.lead = await register(ctx.ev, 'ar-lead', 'Leyla Nəsibova');
  ctx.people.mate = await register(ctx.ev, 'ar-mate', 'Murad Səfərov');
  ctx.people.pending = await register(ctx.ev, 'ar-pend', 'Pərvin Hüseynli', { approve: false });

  // A team name that a spreadsheet would run as a formula.
  r = await admin.post('/api/teams', {
    eventId: ctx.ev.id, name: `=HYPERLINK("http://x.test","win") ${RUN_ID}`,
    memberIds: [ctx.people.lead.userId, ctx.people.mate.userId], leaderId: ctx.people.lead.userId,
  });
  assert.equal(r.status, 201, r.text);
  ctx.team = r.data;

  r = await admin.post(`/api/events/${ctx.ev.id}/invites`, { email: email('ar-judge'), role: 'judge' });
  assert.ok([200, 201].includes(r.status), r.text);
  ctx.judge = new Session('ar-judge');
  await ctx.judge.register({ fullName: 'Judge Kamran', email: email('ar-judge'), eventCode: ctx.ev.event_code });

  await admin.put(`/api/events/${ctx.ev.id}`, { start_date: iso(-HOUR), end_date: iso(DAY) });
  // The organiser opened judging while submissions are still open (rolling
  // judging); without a judging start it opens when submissions close.
  await dbQuery("UPDATE events SET judging_start = now() - interval '1 minute' WHERE id = $1", [ctx.ev.id]);
  r = await ctx.people.lead.s.post('/api/submissions', { eventId: ctx.ev.id, projectName: 'Qovluq', description: 'Files for everyone', repoLink: 'https://github.com/ar/qovluq' });
  assert.equal(r.status, 201, r.text);
  ctx.sub = r.data;
  r = await ctx.people.lead.s.upload(`/api/files?purpose=submission&eventId=${ctx.ev.id}`, PDF, { type: 'application/pdf', name: 'pitch-deck.pdf' });
  assert.equal(r.status, 201, r.text);
  r = await ctx.people.lead.s.put(`/api/submissions/${ctx.sub.id}`, { fileIds: [r.data.id] });
  assert.equal(r.status, 200, r.text);

  r = await ctx.judge.post(`/api/events/${ctx.ev.id}/judging/me/reviews`, { submissionId: ctx.sub.id, scores: [{ criterionId: ctx.crit, score: 8 }], feedback: 'Solid' });
  assert.equal(r.status, 200, r.text);
  r = await ctx.people.mate.s.post(`/api/events/${ctx.ev.id}/feedback`, { rating: 5, comment: 'Great mentors', type: 'Ümumi' });
  assert.equal(r.status, 201, r.text);
});

test('NPS opens when the event ends, for admitted participants only', async () => {
  const { lead, pending } = ctx.people;
  let r = await lead.s.get(`/api/events/${ctx.ev.id}/feedback/nps/mine`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.eligible, true);
  assert.equal(r.data.open, false);
  r = await lead.s.post(`/api/events/${ctx.ev.id}/feedback/nps`, { score: 9 });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'NPS_NOT_OPEN');

  await admin.put(`/api/events/${ctx.ev.id}`, { end_date: iso(-HOUR) });
  r = await lead.s.get(`/api/events/${ctx.ev.id}/feedback/nps/mine`);
  assert.equal(r.data.open, true);
  r = await lead.s.post(`/api/events/${ctx.ev.id}/feedback/nps`, { score: 11 });
  assert.equal(r.status, 400, r.text);
  r = await lead.s.post(`/api/events/${ctx.ev.id}/feedback/nps`, { score: '' });
  assert.equal(r.status, 400, r.text);
  r = await lead.s.post(`/api/events/${ctx.ev.id}/feedback/nps`, { score: 6, comment: 'Wifi was slow' });
  assert.equal(r.status, 200, r.text);
  r = await lead.s.post(`/api/events/${ctx.ev.id}/feedback/nps`, { score: 9, comment: 'Wifi was slow, everything else great' });
  assert.equal(r.status, 200, 'an answer can change');
  r = await ctx.people.mate.s.post(`/api/events/${ctx.ev.id}/feedback/nps`, { score: 10 });
  assert.equal(r.status, 200, r.text);
  const rows = (await dbQuery("SELECT nps FROM feedback WHERE event_id = $1 AND type = 'nps' ORDER BY nps", [ctx.ev.id])).rows;
  assert.deepEqual(rows.map((x) => x.nps), [9, 10], 'one answer each');

  r = await pending.s.post(`/api/events/${ctx.ev.id}/feedback/nps`, { score: 0 });
  assert.equal(r.status, 403, 'a pending registration does not answer');
  r = await ctx.judge.post(`/api/events/${ctx.ev.id}/feedback/nps`, { score: 0 });
  assert.equal(r.status, 403, 'staff do not answer the participants\' question');
  r = await lead.s.post(`/api/events/${ctx.ev.id}/feedback`, { rating: 5, type: 'nps' });
  assert.equal(r.status, 400, 'not around the rules through written feedback');
  r = await lead.s.post(`/api/events/${ctx.ev.id}/feedback`, { rating: 9, comment: 'x' });
  assert.equal(r.status, 400, 'written feedback is rated 1 to 5');
});

test('the organiser sees the score, the spread and comments, without names', async () => {
  let r = await admin.get(`/api/events/${ctx.ev.id}/feedback/nps`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.responses, 2);
  assert.equal(r.data.eligible, 2);
  assert.equal(r.data.responseRate, 100);
  assert.equal(r.data.promoters, 2);
  assert.equal(r.data.score, 100);
  assert.equal(r.data.distribution[9], 1);
  assert.equal(r.data.distribution[10], 1);
  assert.deepEqual(r.data.comments.map((c) => c.comment), ['Wifi was slow, everything else great']);
  assert.ok(!/Leyla|ar-lead|@/.test(JSON.stringify(r.data)), 'anonymous');
  r = await admin.get(`/api/events/${ctx.ev.id}/feedback`);
  assert.ok(r.data.every((f) => f.type !== 'nps'), 'written feedback only');
  r = await ctx.people.lead.s.get(`/api/events/${ctx.ev.id}/feedback/nps`);
  assert.equal(r.status, 403);
});

test('the ZIP export holds the whole event, safe for spreadsheets', async () => {
  const r = await admin.download(`/api/events/${ctx.ev.id}/export.zip`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/zip');
  assert.match(r.headers.get('content-disposition'), /attachment; filename=".+\.zip"/);
  const files = unzip(r.body);
  for (const name of ['README.txt', 'event.json', 'participants.csv', 'teams.csv', 'submissions.csv', 'scores.csv', 'results.csv',
    'certificates.csv', 'announcements.csv', 'help-requests.csv', 'feedback.csv', 'nps.csv']) {
    assert.ok(files[name], `${name} is in the archive`);
  }
  const text = (n) => files[n].toString('utf8');
  assert.ok(text('participants.csv').includes('Leyla Nəsibova'));
  assert.ok(text('participants.csv').includes('Pərvin Hüseynli'), 'pending registrations too');
  assert.ok(text('teams.csv').includes("'=HYPERLINK"), 'a formula is defused');
  assert.ok(!/(^|,)=HYPERLINK/m.test(text('teams.csv')));
  assert.ok(text('scores.csv').includes('Judge Kamran') && text('scores.csv').includes('Solid'));
  assert.ok(text('results.csv').includes('live ranking'), 'not published yet, so the live ranking');
  assert.ok(text('nps.csv').includes('Wifi was slow') && !text('nps.csv').includes('Leyla'), 'NPS stays anonymous');
  assert.equal(JSON.parse(text('event.json')).criteria[0].name, 'Quality');
  const deck = Object.keys(files).find((n) => n.startsWith('files/projects/') && n.endsWith('pitch-deck.pdf'));
  assert.ok(deck, 'the project file is included');
  assert.ok(files[deck].equals(PDF), 'byte for byte');

  let x = await ctx.people.lead.s.download(`/api/events/${ctx.ev.id}/export.zip`);
  assert.equal(x.status, 403, 'participants cannot export');
  const other = await approvedBuyer('ar-other');
  ctx.other = other.session;
  x = await ctx.other.download(`/api/events/${ctx.ev.id}/export.zip`);
  assert.equal(x.status, 404, 'another organisation cannot either');
});

test('archived: every change is refused, for everyone who can see the event', async () => {
  let r = await admin.post(`/api/events/${ctx.ev.id}/archive`, {});
  assert.equal(r.status, 200, r.text);
  assert.ok(r.data.archivedAt);
  const { lead, mate } = ctx.people;
  const refused = [
    ['organiser edits the event', () => admin.put(`/api/events/${ctx.ev.id}`, { name: 'Renamed' })],
    ['organiser edits the builder', () => admin.patch(`/api/events/${ctx.ev.id}/builder`, { tagline: 'New' })],
    ['organiser changes a participant', () => admin.patch(`/api/events/${ctx.ev.id}/participants/${ctx.people.pending.pid}`, { status: 'approved' })],
    ['organiser creates a team', () => admin.post('/api/teams', { eventId: ctx.ev.id, name: `Late ${RUN_ID}`, memberIds: [], leaderId: null })],
    ['organiser renames a team', () => admin.put(`/api/teams/${ctx.team.id}`, { name: 'Renamed' })],
    ['organiser announces', () => admin.post('/api/announcements', { eventId: ctx.ev.id, title: 'Hi', content: 'Late' })],
    ['organiser invites staff', () => admin.post(`/api/events/${ctx.ev.id}/invites`, { email: email('ar-late'), role: 'mentor' })],
    ['organiser publishes results', () => admin.post(`/api/events/${ctx.ev.id}/results/publish`, {})],
    ['organiser issues certificates', () => admin.post(`/api/events/${ctx.ev.id}/certificates/issue`, {})],
    ['organiser uploads a logo', () => admin.upload(`/api/files?purpose=event_logo&eventId=${ctx.ev.id}`, PDF, { type: 'image/png' })],
    ['judge scores', () => ctx.judge.post(`/api/events/${ctx.ev.id}/judging/me/reviews`, { submissionId: ctx.sub.id, scores: [{ criterionId: ctx.crit, score: 2 }] })],
    ['lead edits the project', () => lead.s.put(`/api/submissions/${ctx.sub.id}`, { description: 'Changed after the end' })],
    ['participant asks for help', () => mate.s.post('/api/tickets', { eventId: ctx.ev.id, topic: 'Late', description: 'Help' })],
    ['participant writes feedback', () => mate.s.post(`/api/events/${ctx.ev.id}/feedback`, { rating: 4, comment: 'Late' })],
    ['participant answers NPS', () => mate.s.post(`/api/events/${ctx.ev.id}/feedback/nps`, { score: 3 })],
  ];
  for (const [what, call] of refused) {
    // eslint-disable-next-line no-await-in-loop
    r = await call();
    assert.equal(r.status, 409, `${what}: ${r.status} ${r.text}`);
    assert.equal(r.json.code, 'EVENT_ARCHIVED', what);
  }
  const ev = (await dbQuery('SELECT name FROM events WHERE id = $1', [ctx.ev.id])).rows[0];
  assert.notEqual(ev.name, 'Renamed');
  const sub = (await dbQuery('SELECT description FROM submissions WHERE id = $1', [ctx.sub.id])).rows[0];
  assert.equal(sub.description, 'Files for everyone');
});

test('archived: reading, exporting and sending certificates again still work', async () => {
  let r = await admin.get(`/api/events/${ctx.ev.id}/builder`);
  assert.equal(r.status, 200, r.text);
  r = await admin.get(`/api/events/${ctx.ev.id}/participants`);
  assert.equal(r.status, 200, r.text);
  r = await ctx.people.lead.s.get(`/api/events/${ctx.ev.id}/feedback/nps/mine`);
  assert.equal(r.data.open, false);
  assert.equal(r.data.closed, true);
  r = await admin.download(`/api/events/${ctx.ev.id}/export.zip`);
  assert.equal(r.status, 200);
  r = await admin.post(`/api/events/${ctx.ev.id}/certificates/email`, {});
  assert.equal(r.status, 200, r.text);
});

test('archived: other organisations learn nothing; nobody signs up', async () => {
  let r = await ctx.other.put(`/api/events/${ctx.ev.id}`, { name: 'Mine now' });
  assert.equal(r.status, 404, 'the same answer as for any event they cannot reach');
  r = await ctx.other.patch(`/api/events/${ctx.ev.id}/builder`, { tagline: 'x' });
  assert.equal(r.status, 404, r.text);
  r = await anon.post(`/api/events/${ctx.ev.id}/feedback`, { rating: 3 });
  assert.equal(r.status, 401, r.text);

  r = await anon.post(`/api/public/events/${ctx.ev.slug}/register`, {
    account: { fullName: 'Late Comer', email: email('ar-late1'), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'EVENT_ARCHIVED');
  r = await new Session('ar-late2').post('/api/auth/register', { fullName: 'Late Comer', email: email('ar-late2'), password: 'Test1234!', eventCode: ctx.ev.event_code });
  assert.equal(r.status, 409, r.text);
  assert.equal((await dbQuery('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)', [email('ar-late2')])).rows.length, 0, 'no account was made');
});

test('bringing it back makes it editable again', async () => {
  let r = await admin.post(`/api/events/${ctx.ev.id}/unarchive`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.archivedAt, null);
  r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { tagline: 'Back again' });
  assert.equal(r.status, 200, r.text);
  r = await ctx.people.mate.s.post(`/api/events/${ctx.ev.id}/feedback/nps`, { score: 8 });
  assert.equal(r.status, 200, r.text);
  const ev = (await dbQuery('SELECT status, archived_at FROM events WHERE id = $1', [ctx.ev.id])).rows[0];
  assert.equal(ev.archived_at, null);
  assert.equal(ev.status, 'upcoming', 'the dates decide the phase again');
});

test('an archived event can still be deleted', async () => {
  const ev = await newEvent('ARDEL');
  let r = await admin.post(`/api/events/${ev.id}/archive`, {});
  assert.equal(r.status, 200, r.text);
  r = await admin.delete(`/api/events/${ev.id}`);
  assert.equal(r.status, 200, r.text);
  assert.equal((await dbQuery('SELECT 1 FROM events WHERE id = $1', [ev.id])).rows.length, 0);
});

test('archived by itself 14 days after the end; not drafts, not one brought back', async () => {
  const { autoArchive } = require('../src/services/eventArchive.service');
  const old = await newEvent('AROLD', { start_date: iso(-20 * DAY), end_date: iso(-15 * DAY), registration_start: iso(-30 * DAY), registration_end: iso(-21 * DAY) });
  const recent = await newEvent('ARNEW', { start_date: iso(-12 * DAY), end_date: iso(-10 * DAY), registration_start: iso(-30 * DAY), registration_end: iso(-13 * DAY) });
  const draft = await newEvent('ARDRAFT', { is_published: false, start_date: iso(-20 * DAY), end_date: iso(-15 * DAY), registration_start: iso(-30 * DAY), registration_end: iso(-21 * DAY) });
  const back = await newEvent('ARBACK', { start_date: iso(-20 * DAY), end_date: iso(-15 * DAY), registration_start: iso(-30 * DAY), registration_end: iso(-21 * DAY) });
  await dbQuery('UPDATE events SET is_published = false, status = \'draft\' WHERE id = $1', [draft.id]);
  let r = await admin.post(`/api/events/${back.id}/archive`, {});
  assert.equal(r.status, 200, r.text);
  r = await admin.post(`/api/events/${back.id}/unarchive`, {});
  assert.equal(r.status, 200, r.text);

  // The API's own hourly sweep may get there first; either way the outcome is the same.
  await autoArchive();
  const archived = async (ev) => Boolean((await dbQuery('SELECT archived_at FROM events WHERE id = $1', [ev.id])).rows[0].archived_at);
  assert.equal(await archived(old), true, 'ended 15 days ago');
  assert.equal(await archived(recent), false, 'ended 10 days ago');
  assert.equal(await archived(draft), false, 'a draft is left alone');
  assert.equal(await archived(back), false, 'its organiser brought it back');
  const a = (await dbQuery("SELECT action, meta FROM audit_log WHERE event_id = $1 AND action = 'event.archived'", [old.id])).rows;
  assert.equal(a.length, 1);
  assert.equal(a[0].meta.auto, true);
  r = await admin.patch(`/api/events/${old.id}/builder`, { tagline: 'x' });
  assert.equal(r.status, 409, 'read-only now');
  assert.ok(!(await autoArchive()).includes(Number(old.id)), 'nothing twice');
});
