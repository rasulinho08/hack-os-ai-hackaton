/**
 * The event builder's settings change what happens, end to end against a
 * running API (see e2e.test.js for how to run).
 *
 * Covers: the mentors' help queue (switched off, per-team limit); the team
 * deadline closes team changes before the start; the online link reaches
 * only admitted participants; submissions follow the organiser's
 * required/optional/off choices and take files within the event's size and
 * types, readable by the team, judges and organisers only; presentation
 * slots take the organiser's length and order and follow the demo day; the
 * event's e-mail signature.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { dbQuery } = require('./fixtures');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

const admin = new Session('s-admin');
const ctx = {};
const fields = (r) => (r.json?.errors || []).map((e) => e.field);

async function makeEvent(tag, extra = {}) {
  const r = await admin.post('/api/events', {
    event_code: `ST${tag}${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
    name: `Settings ${tag} ${RUN_ID}`,
    registration_start: iso(-1 * DAY),
    registration_end: iso(1 * DAY),
    start_date: iso(2 * DAY),
    end_date: iso(4 * DAY),
    team_size_limit: 4,
    min_team_size: 1,
    is_published: true,
    ...extra,
  });
  assert.equal(r.status, 201, r.text);
  return r.data;
}

/** Someone new registers on the event's page; returns their signed-in session. */
async function register(ev, tag, entry = { type: 'solo' }) {
  const s = new Session(tag);
  const r = await s.post(`/api/public/events/${ev.slug}/register`, {
    account: { fullName: `Person ${tag}`, email: email(tag), password: 'Test1234!' },
    entry,
    answers: {},
    accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  return { s, data: r.data };
}

async function approve(ev, tag) {
  const list = await admin.get(`/api/events/${ev.id}/participants`);
  assert.equal(list.status, 200, list.text);
  const p = list.data.find((x) => String(x.email).toLowerCase() === email(tag).toLowerCase());
  assert.ok(p, `${tag} is listed`);
  const r = await admin.patch(`/api/events/${ev.id}/participants/${p.id}`, { status: 'approved' });
  assert.equal(r.status, 200, r.text);
}

const patchEvent = async (ev, body) => {
  const r = await admin.patch(`/api/events/${ev.id}/builder`, body);
  assert.equal(r.status, 200, r.text);
  return r.data;
};

test('setup: the organiser', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
});

// ── Mentors' help queue ─────────────────────────────────────────────────────

test('help requests follow the mentors settings: off, then one open request per team', async () => {
  const ev = await makeEvent('tix');
  const lead = await register(ev, 'tix-lead', { type: 'lead', teamName: 'Queue Testers' });
  await approve(ev, 'tix-lead');

  await patchEvent(ev, { mentor_config: { ticketsEnabled: false } });
  let r = await lead.s.post('/api/tickets', { eventId: ev.id, topic: 'Help', description: 'Our build fails' });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'TICKETS_DISABLED');

  await patchEvent(ev, { mentor_config: { ticketsEnabled: true, maxOpenTicketsPerTeam: 1 } });
  r = await lead.s.post('/api/tickets', { eventId: ev.id, topic: 'Help', description: 'Our build fails' });
  assert.equal(r.status, 201, r.text);
  const first = r.data;
  r = await lead.s.post('/api/tickets', { eventId: ev.id, topic: 'More help', description: 'Still failing' });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'TICKET_LIMIT');

  // Once resolved, the team may ask again.
  await dbQuery("UPDATE help_tickets SET status = 'resolved' WHERE id = $1", [first.id]);
  r = await lead.s.post('/api/tickets', { eventId: ev.id, topic: 'Another', description: 'New question' });
  assert.equal(r.status, 201, r.text);
});

// ── Team deadline ───────────────────────────────────────────────────────────

test('the team deadline closes team changes even before the event starts', async () => {
  const ev = await makeEvent('tdl');
  await register(ev, 'tdl-a');
  await approve(ev, 'tdl-a');
  const a = new Session('tdl-a2');
  await a.login(email('tdl-a'), 'Test1234!');

  await dbQuery("UPDATE events SET team_deadline = now() - interval '1 hour' WHERE id = $1", [ev.id]);
  let r = await a.post('/api/teams', { eventId: ev.id, name: `Late Team ${RUN_ID}` });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'TEAM_FORMATION_CLOSED');

  // Registration says the same for someone who wants to create a team now.
  const s = new Session('tdl-b');
  r = await s.post(`/api/public/events/${ev.slug}/register`, {
    account: { fullName: 'Late Lead', email: email('tdl-b'), password: 'Test1234!' },
    entry: { type: 'lead', teamName: 'Too Late' },
    accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'TEAM_FORMATION_CLOSED');

  // A deadline after the start keeps teams open once the event is running.
  await dbQuery(
    "UPDATE events SET start_date = now() - interval '2 hours', team_deadline = now() + interval '2 hours' WHERE id = $1",
    [ev.id],
  );
  r = await a.post('/api/teams', { eventId: ev.id, name: `Open Team ${RUN_ID}` });
  assert.equal(r.status, 201, r.text);
});

// ── Online link ─────────────────────────────────────────────────────────────

test('the online link reaches admitted participants and the event team only', async () => {
  const ev = await makeEvent('onl');
  await patchEvent(ev, { format: 'online', online_url: 'https://meet.example.com/room-42' });
  const p = await register(ev, 'onl-p');

  let r = await p.s.get(`/api/events/${ev.id}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.online_url, undefined, 'pending: no room link');

  r = await new Session('onl-anon').get(`/api/public/events/${ev.slug}`);
  assert.equal(r.data.online_url, undefined, 'the public page never has it');

  await approve(ev, 'onl-p');
  r = await p.s.get(`/api/events/${ev.id}`);
  assert.equal(r.data.online_url, 'https://meet.example.com/room-42');
  r = await p.s.get('/api/events/active');
  assert.equal(r.data.online_url, 'https://meet.example.com/room-42');

  r = await admin.get(`/api/events/${ev.id}`);
  assert.equal(r.data.online_url, 'https://meet.example.com/room-42', 'organisers see it');
});

// ── Submissions ─────────────────────────────────────────────────────────────

test('setup: a running event with a team of two', async () => {
  const ev = await makeEvent('sub');
  const lead = await register(ev, 'sub-lead', { type: 'lead', teamName: 'Builders' });
  const code = lead.data.team.join_code;
  const member = await register(ev, 'sub-mem', { type: 'member', teamCode: code });
  const outsider = await register(ev, 'sub-out');
  for (const tag of ['sub-lead', 'sub-mem', 'sub-out']) await approve(ev, tag);
  await dbQuery(
    `UPDATE events SET start_date = now() - interval '1 hour', end_date = now() + interval '1 day',
            submission_deadline = now() + interval '12 hours', team_deadline = NULL WHERE id = $1`,
    [ev.id],
  );
  // A judge for the event.
  const judgeMail = email('sub-judge');
  let r = await admin.post(`/api/events/${ev.id}/invites`, { email: judgeMail, role: 'judge' });
  assert.equal(r.status, 201, r.text);
  const judge = new Session('sub-judge');
  await judge.register({ fullName: 'Sub Judge', email: judgeMail, eventId: ev.id });
  Object.assign(ctx, { sub: { ev, lead: lead.s, member: member.s, outsider: outsider.s, judge } });
});

test('the form follows the organiser: required, optional and off', async () => {
  const { ev, lead } = ctx.sub;
  await patchEvent(ev, {
    submission_config: {
      fields: { repo: 'off', demo: 'optional', slides: 'optional', video: 'required', summary: 'required', tech: 'off' },
      files: { enabled: true, maxMb: 2, types: ['pdf'] },
    },
  });

  let r = await lead.get(`/api/submissions/rules?eventId=${ev.id}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.fields.video, 'required');
  assert.equal(r.data.files.enabled, true);
  assert.equal(r.data.files.maxMb, 2);
  assert.equal(r.data.open, true);

  r = await lead.post('/api/submissions', { eventId: ev.id, projectName: 'Rules Test', description: 'What it does' });
  assert.equal(r.status, 400, r.text);
  assert.ok(fields(r).includes('videoLink'), 'a required video is asked for');

  r = await lead.post('/api/submissions', {
    eventId: ev.id, projectName: 'Rules Test', description: 'What it does',
    videoLink: 'not a link',
  });
  assert.equal(r.status, 400, r.text);
  assert.ok(fields(r).includes('videoLink'));

  r = await lead.post('/api/submissions', {
    eventId: ev.id, projectName: 'Rules Test', description: 'What it does',
    videoLink: 'https://youtu.be/demo', repoLink: 'https://github.com/team/kept-out', techStack: 'Node',
  });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.video_link, 'https://youtu.be/demo');
  assert.equal(r.data.repo_link, null, 'a field that is off is not kept');
  assert.equal(r.data.tech_stack, null);
  ctx.sub.submission = r.data;
});

test('files: the event\'s types and size, the lead only, attached by the submission', async () => {
  const { ev, lead, member, outsider, judge, submission } = ctx.sub;

  let r = await lead.upload(`/api/files?purpose=submission&eventId=${ev.id}`, PNG, { type: 'image/png', name: 'shot.png' });
  assert.equal(r.status, 415, 'only the types the organiser chose');
  r = await member.upload(`/api/files?purpose=submission&eventId=${ev.id}`, PDF, { type: 'application/pdf', name: 'deck.pdf' });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'NOT_TEAM_LEAD');
  const big = Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024 + 10, 0x20)]);
  r = await lead.upload(`/api/files?purpose=submission&eventId=${ev.id}`, big, { type: 'application/pdf', name: 'big.pdf' });
  assert.equal(r.status, 413, 'within the event\'s size');

  r = await lead.upload(`/api/files?purpose=submission&eventId=${ev.id}`, PDF, { type: 'application/pdf', name: 'deck.pdf' });
  assert.equal(r.status, 201, r.text);
  const fileId = r.data.id;

  r = await lead.put(`/api/submissions/${submission.id}`, { fileIds: [fileId] });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.files.map((f) => f.id), [fileId]);
  assert.equal(r.data.files[0].filename, 'deck.pdf');

  // Who can open it.
  assert.equal((await member.download(`/api/files/${fileId}`)).status, 200, 'the team');
  assert.equal((await judge.download(`/api/files/${fileId}`)).status, 200, 'the event\'s judges');
  assert.equal((await admin.download(`/api/files/${fileId}`)).status, 200, 'the organisers');
  assert.equal((await outsider.download(`/api/files/${fileId}`)).status, 404, 'another participant does not');

  // Someone else's file cannot be attached.
  r = await outsider.upload(`/api/files?purpose=submission&eventId=${ev.id}`, PDF, { type: 'application/pdf', name: 'x.pdf' });
  assert.equal(r.status, 404, 'an outsider without a team cannot upload project files');

  // Dropping a file from the list deletes it.
  r = await lead.put(`/api/submissions/${submission.id}`, { fileIds: [] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.files.length, 0);
  assert.equal((await dbQuery('SELECT 1 FROM files WHERE id = $1', [fileId])).rows.length, 0);

  // With files switched off, nothing is uploaded.
  await patchEvent(ev, { submission_config: { files: { enabled: false } } });
  r = await lead.upload(`/api/files?purpose=submission&eventId=${ev.id}`, PDF, { type: 'application/pdf', name: 'deck.pdf' });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'FILES_DISABLED');
});

test('events without settings keep the original rules', async () => {
  const ev = await makeEvent('old');
  const lead = await register(ev, 'old-lead', { type: 'lead', teamName: 'Classic' });
  await approve(ev, 'old-lead');
  await dbQuery("UPDATE events SET start_date = now() - interval '1 hour', end_date = now() + interval '1 day' WHERE id = $1", [ev.id]);
  let r = await lead.s.post('/api/submissions', { eventId: ev.id, projectName: 'Classic', description: 'x' });
  assert.equal(r.status, 400, r.text);
  assert.ok(fields(r).includes('repoLink'), 'the repository stays required');
  r = await lead.s.post('/api/submissions', { eventId: ev.id, projectName: 'Classic', description: 'x', repoLink: 'https://example.com/code' });
  assert.equal(r.status, 400, 'a repository is on a code host');
  r = await lead.s.post('/api/submissions', { eventId: ev.id, projectName: 'Classic', description: 'x', repoLink: 'https://gitlab.com/team/classic' });
  assert.equal(r.status, 201, r.text);
});

// ── Presentation day ───────────────────────────────────────────────────────

test('presentation slots take the organiser\'s length and follow the demo day', async () => {
  const { ev } = ctx.sub;
  const demo = new Date(Date.now() + 3 * DAY);
  demo.setUTCSeconds(0, 0);
  await patchEvent(ev, { presentation_config: { slotMinutes: 4, qaMinutes: 3, warnSeconds: 30, order: 'submission' } });
  await dbQuery('UPDATE events SET demo_day = $2 WHERE id = $1', [ev.id, demo.toISOString()]);

  let r = await admin.get(`/api/events/${ev.id}/presentations/settings`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual({ slot: r.data.slotMinutes, qa: r.data.qaMinutes, warn: r.data.warnSeconds }, { slot: 4, qa: 3, warn: 30 });

  r = await admin.post(`/api/events/${ev.id}/presentations/generate`, {});
  assert.equal(r.status, 200, r.text);
  r = await admin.get(`/api/events/${ev.id}/presentations`);
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].duration, 7, 'talk + Q&A');
  assert.equal(new Date(r.data[0].scheduled_at).getTime(), demo.getTime(), 'the first slot starts on the demo day');

  // A second slot follows the first; a longer first slot pushes it back.
  const team2 = (await dbQuery('SELECT team_id FROM submissions WHERE id = $1', [ctx.sub.submission.id])).rows[0].team_id;
  r = await admin.post(`/api/events/${ev.id}/presentations`, { team_id: team2, submission_id: ctx.sub.submission.id });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.duration, 7);
  assert.equal(new Date(r.data.scheduled_at).getTime(), demo.getTime() + 7 * 60 * 1000);
  const firstId = (await admin.get(`/api/events/${ev.id}/presentations`)).data[0].id;
  r = await admin.patch(`/api/events/${ev.id}/presentations/${firstId}`, { duration: 10 });
  assert.equal(r.status, 200, r.text);
  const after = (await admin.get(`/api/events/${ev.id}/presentations`)).data;
  assert.equal(new Date(after[1].scheduled_at).getTime(), demo.getTime() + 10 * 60 * 1000);
});

// ── E-mail signature ───────────────────────────────────────────────────────

test('the event signs its e-mail with the organiser\'s sender name and reply-to', async () => {
  const { eventSender } = require('../src/services/eventSender');
  const { ev } = ctx.sub;
  let sender = await eventSender(ev.id);
  assert.equal(sender.fromName, ev.name, 'the event\'s name by default');
  assert.equal(sender.replyTo, undefined);
  await patchEvent(ev, { comms_config: { senderName: 'ADA Hackathon Team', replyTo: 'team@ada.example' } });
  sender = await eventSender(ev.id);
  assert.deepEqual(sender, { fromName: 'ADA Hackathon Team', replyTo: 'team@ada.example' });
  assert.deepEqual(await eventSender(-1), {}, 'no event, the platform\'s own signature');
  // This test talked to the database directly; let the process end.
  await require('../src/config/db').pool.end();
});
