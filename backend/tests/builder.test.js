/**
 * Event builder, public event page and registration — end to end against a
 * running API (see e2e.test.js for how to run).
 *
 * Covers: drafts from templates cost nothing; saving checks every field and
 * can never publish; lists keep their ids; the plan decides own questions
 * and branding; publishing checks the list and takes the plan's event; the
 * public page shows only what is public; registration applies the event's
 * mode, form, eligibility, capacity and approval; files are checked by their
 * bytes and readable only by the right people; another organisation reaches
 * none of it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { dbQuery, ownerSession, approvedBuyer } = require('./fixtures');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

const admin = new Session('b-admin');
const ctx = {};
const errFields = (r) => (r.json?.errors || []).map((e) => e.field);
const errCodes = (r) => (r.json?.errors || []).map((e) => e.code);

async function planOf(session, customerId) {
  const r = await session.get(`/api/me/organisations/${customerId}/plan`);
  assert.equal(r.status, 200, r.text);
  return r.data;
}

/** Everything the publish checklist asks for, on top of a template. */
const COMPLETE = {
  tagline: 'Two days to build something that matters',
  description: 'A hackathon for students and young professionals: form a team, build, present to the jury.',
  format: 'offline',
  venue_name: 'Tech Hub',
  venue_address: '1 Example street',
  city: 'Bakı',
};

function registrant(label) {
  return new Session(label);
}

test('setup: the organisers', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  ctx.buyer = await approvedBuyer('b-starter');
  ctx.other = await approvedBuyer('b-other');
});

test('templates make drafts that cost nothing', async () => {
  const { session: buyer, customerId } = ctx.buyer;
  let r = await buyer.post('/api/events/drafts', { name: `University Hack ${RUN_ID}`, template: 'university', language: 'en' });
  assert.equal(r.status, 201, r.text);
  const b = r.data;
  assert.equal(b.event.status, 'draft');
  assert.equal(b.event.is_published, false);
  assert.equal(b.event.entitlement_id, null, 'a draft takes nothing from the plan');
  assert.equal(b.event.language, 'en');
  assert.equal(b.event.template, 'university');
  assert.equal(b.event.eligibility.studentsOnly, true);
  assert.ok(b.event.rules && b.event.rules.length > 100, 'house rules are filled in');
  assert.equal(b.fields.length, 17, 'every standard field has a row');
  const uni = b.fields.find((f) => f.field_key === 'university');
  assert.equal(uni.required, true);
  assert.equal(b.criteria.length, 4);
  assert.equal(b.prizes.length, 3);
  assert.equal(b.plan, 'starter', 'a draft is shown against the plan it would publish under');
  assert.equal(b.limits.participants, require('../src/constants/plans').PLANS.starter.participants, "Starter's participants");
  assert.equal(b.ready, false);
  assert.ok(b.checklist.some((i) => i.code === 'tagline_missing' && i.severity === 'error'));
  ctx.uniEvent = b.event;

  r = await buyer.post('/api/events/drafts', { name: `University Hack ${RUN_ID}`, template: 'blank' });
  assert.equal(r.status, 201, r.text);
  assert.notEqual(r.data.event.slug, ctx.uniEvent.slug, 'the same name gets its own link');
  assert.notEqual(r.data.event.event_code, ctx.uniEvent.event_code);
  assert.equal(r.data.criteria.length, 0);
  assert.equal(r.data.prizes.length, 0);
  ctx.blankEvent = r.data.event;

  r = await buyer.post('/api/events/drafts', { name: 'ab' });
  assert.equal(r.status, 400);
  assert.deepEqual(errFields(r), ['name']);

  const plan = await planOf(buyer, customerId);
  assert.equal(plan.eventsRemaining, 1, 'two drafts, the plan\'s event still unused');
});

test('saving checks every field and never publishes', async () => {
  const { session: buyer } = ctx.buyer;
  const id = ctx.uniEvent.id;
  let r = await buyer.patch(`/api/events/${id}/builder`, {
    timezone: 'Mars/Olympus', map_url: 'javascript:alert(1)', max_participants: 0, registration_mode: 'pairs',
  });
  assert.equal(r.status, 400, r.text);
  assert.deepEqual(errFields(r).sort(), ['map_url', 'max_participants', 'registration_mode', 'timezone']);

  r = await buyer.patch(`/api/events/${id}/builder`, { is_published: true, status: 'ongoing', event_code: 'HIJACK', tagline: 'Saved alone' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.event.is_published, false, 'saving never publishes');
  assert.equal(r.data.event.status, 'draft');
  assert.equal(r.data.event.event_code, ctx.uniEvent.event_code);
  assert.equal(r.data.event.tagline, 'Saved alone');

  r = await buyer.patch(`/api/events/${id}/builder`, { judging_start: iso(40 * DAY), judging_end: iso(39 * DAY) });
  assert.equal(r.status, 400);
  assert.ok(errFields(r).includes('judging_end'));

  r = await buyer.patch(`/api/events/${id}/builder`, { slug: ctx.blankEvent.slug });
  assert.equal(r.status, 400);
  assert.deepEqual(errFields(r), ['slug']);

  r = await buyer.patch(`/api/events/${id}/builder`, { brand_color: '#1f6feb' });
  assert.equal(r.status, 403, 'branding is not part of Starter');
  assert.equal(r.json.code, 'MODULE_DISABLED');

  r = await buyer.patch(`/api/events/${id}/builder`, {
    start_date: iso(30 * DAY), end_date: iso(32 * DAY), registration_start: iso(-1 * DAY), registration_end: iso(28 * DAY),
    max_participants: 120, judging_config: { blind: true }, faq: [{ q: 'Is it free?', a: 'Yes.' }, { q: '', a: '' }],
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.event.max_participants, 120);
  assert.equal(r.data.event.judging_config.blind, true);
  assert.equal(r.data.event.judging_config.resultsVisibility, 'own_and_winners', 'settings not sent keep their value');
  assert.equal(r.data.event.faq.length, 1, 'empty FAQ rows are dropped');
  assert.ok(new Date(r.data.event.team_deadline) <= new Date(r.data.event.end_date), 'dates the organiser did not touch follow the event');

  r = await buyer.patch(`/api/events/${id}/builder`, { presentation_config: { slotMinutes: 4 } });
  assert.equal(r.status, 403, 'the presentation day is not part of Starter');
});

test('lists keep their ids', async () => {
  const { session: buyer } = ctx.buyer;
  const id = ctx.uniEvent.id;
  let r = await buyer.put(`/api/events/${id}/builder/tracks`, { items: [{ cid: 'ai', name: 'AI' }, { cid: 'fin', name: 'Fintech' }] });
  assert.equal(r.status, 200, r.text);
  const ai = r.data.idsByCid.ai;
  const fin = r.data.idsByCid.fin;
  r = await buyer.put(`/api/events/${id}/builder/tracks`, { items: [{ id: fin, name: 'Finance' }, { id: ai, name: 'AI & Data' }] });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.items.map((t) => [t.id, t.name]), [[fin, 'Finance'], [ai, 'AI & Data']], 'renamed and reordered in place');

  r = await buyer.get(`/api/events/${id}/builder`);
  const places = r.data.prizes;
  r = await buyer.put(`/api/events/${id}/builder/prizes`, {
    items: [...places.map((p) => ({ id: p.id, kind: 'place', position: p.position, name: p.name, value: '500 AZN' })),
      { cid: 'tp', kind: 'track', trackId: ai, name: 'Best AI project' }],
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.items.length, 4);
  r = await buyer.put(`/api/events/${id}/builder/prizes`, { items: [{ kind: 'place', position: 1, name: 'A' }, { kind: 'place', position: 1, name: 'B' }] });
  assert.equal(r.status, 400, 'two prizes for the same place');
  r = await buyer.put(`/api/events/${id}/builder/tracks`, { items: [{ id: fin, name: 'Finance' }] });
  assert.equal(r.status, 400, 'a track with prizes cannot disappear');
  assert.ok(errCodes(r).includes('TRACK_IN_USE'));

  r = await buyer.get(`/api/events/${id}/builder`);
  const [c1, c2] = r.data.criteria;
  r = await buyer.put(`/api/events/${id}/builder/criteria`, {
    items: [{ id: c1.id, name: c2.name, maxScore: 10, weight: 2 }, { id: c2.id, name: c1.name, maxScore: 10, weight: 1 }],
  });
  assert.equal(r.status, 200, `swapping two names saves: ${r.text}`);
  assert.equal(r.data.items.find((c) => c.id === c1.id).name, c2.name);

  // A criterion judges already scored stays.
  const buyerId = (await buyer.get('/api/auth/me')).data.id;
  const judge = (await dbQuery('INSERT INTO judges (event_id, user_id) VALUES ($1, $2) RETURNING id', [id, buyerId])).rows[0].id;
  const team = (await dbQuery("INSERT INTO teams (name, event_id, join_code) VALUES ('Scored', $1, $2) RETURNING id", [id, `sc${RUN_ID}`.slice(0, 20)])).rows[0].id;
  const sub = (await dbQuery("INSERT INTO submissions (team_id, event_id, project_name) VALUES ($1, $2, 'P') RETURNING id", [team, id])).rows[0].id;
  await dbQuery('INSERT INTO scores (judge_id, submission_id, criterion_id, score) VALUES ($1, $2, $3, 7)', [judge, sub, c1.id]);
  r = await buyer.put(`/api/events/${id}/builder/criteria`, { items: [{ id: c2.id, name: 'Only one', maxScore: 10, weight: 1 }] });
  assert.equal(r.status, 400);
  assert.ok(errCodes(r).includes('CRITERION_SCORED'));
  r = await buyer.put(`/api/events/${id}/builder/criteria`, { items: [{ id: c1.id, name: c2.name, maxScore: 20, weight: 1 }] });
  assert.equal(r.status, 400, 'its maximum cannot change either');
  await dbQuery('DELETE FROM teams WHERE id = $1', [team]);
  await dbQuery('DELETE FROM judges WHERE id = $1', [judge]);
});

test('own questions need the Professional plan; standard fields are for everyone', async () => {
  const { session: buyer } = ctx.buyer;
  const id = ctx.uniEvent.id;
  let r = await buyer.get(`/api/events/${id}/builder`);
  const fields = r.data.fields.map((f) => ({ id: f.id, key: f.field_key, enabled: f.field_key === 'gender' ? true : f.enabled, required: f.required, sensitive: f.sensitive }));
  r = await buyer.put(`/api/events/${id}/builder/form`, { items: [...fields, { cid: 'q', type: 'text', label: 'Why you?', required: true }] });
  assert.equal(r.status, 400, 'Starter cannot add its own questions');
  assert.ok(errCodes(r).includes('MODULE_DISABLED'));
  r = await buyer.put(`/api/events/${id}/builder/form`, { items: fields });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.items.find((f) => f.field_key === 'gender').enabled, true);
});

test('impossible schedules are refused on save and block publishing', async () => {
  const { session: buyer } = ctx.buyer;
  const id = ctx.uniEvent.id;
  let r = await buyer.get(`/api/events/${id}/builder`);
  assert.equal(r.status, 200, r.text);
  const ev = r.data.event;
  const before = (at, h) => new Date(new Date(at).getTime() - h * 3600e3).toISOString();

  r = await buyer.patch(`/api/events/${id}/builder`, { submission_deadline: before(ev.start_date, 24) });
  assert.equal(r.status, 400, r.text);
  const deadlineErr = r.json.errors.find((e) => e.field === 'submission_deadline');
  assert.ok(deadlineErr, r.text);
  assert.deepEqual([deadlineErr.code, deadlineErr.other], ['TIMELINE_BEFORE', 'start_date']);

  const close = ev.submission_deadline || ev.end_date;
  // Judging may start before submissions close (rolling judging); not before the event starts.
  r = await buyer.patch(`/api/events/${id}/builder`, { judging_start: before(close, 1) });
  assert.equal(r.status, 200, `rolling judging: ${r.text}`);
  r = await buyer.patch(`/api/events/${id}/builder`, { judging_start: before(ev.start_date, 1) });
  assert.equal(r.status, 400, r.text);
  assert.ok(errFields(r).includes('judging_start'));
  r = await buyer.patch(`/api/events/${id}/builder`, { judging_start: null });
  assert.equal(r.status, 200, r.text);
  for (const field of ['results_at', 'demo_day']) {
    // eslint-disable-next-line no-await-in-loop
    r = await buyer.patch(`/api/events/${id}/builder`, { [field]: before(close, 1) });
    assert.equal(r.status, 400, `${field}: ${r.text}`);
    assert.ok(errFields(r).includes(field), `${field} before submissions close is refused`);
  }

  r = await buyer.patch(`/api/events/${id}/builder`, { registration_end: new Date(new Date(ev.end_date).getTime() + 3600e3).toISOString() });
  assert.equal(r.status, 400, r.text);
  assert.ok(errFields(r).includes('registration_end'));

  // The plain update route refuses the same.
  r = await buyer.put(`/api/events/${id}`, { submission_deadline: before(ev.start_date, 24) });
  assert.equal(r.status, 400, r.text);
  assert.ok(errFields(r).includes('submission_deadline'), r.text);

  // A contradiction already stored (an older event): on the checklist, and publishing waits for it.
  const stored = (await dbQuery('SELECT submission_deadline FROM events WHERE id = $1', [id])).rows[0].submission_deadline;
  await dbQuery('UPDATE events SET submission_deadline = start_date - interval \'1 day\' WHERE id = $1', [id]);
  try {
    r = await buyer.get(`/api/events/${id}/builder`);
    const item = r.data.checklist.find((i) => i.code === 'timeline_order');
    assert.ok(item, JSON.stringify(r.data.checklist));
    assert.deepEqual([item.severity, item.section, item.params.field, item.params.rel, item.params.other], ['error', 'schedule', 'submission_deadline', 'before', 'start_date']);
    r = await buyer.post(`/api/events/${id}/builder/publish`);
    assert.equal(r.status, 422, r.text);
    assert.ok(r.json.errors.some((e) => e.code === 'timeline_order' && e.params.field === 'submission_deadline'));
  } finally {
    await dbQuery('UPDATE events SET submission_deadline = $2 WHERE id = $1', [id, stored]);
  }
});

test('publishing checks the list and takes the plan\'s event', async () => {
  const { session: buyer, customerId } = ctx.buyer;
  const id = ctx.uniEvent.id;
  let r = await buyer.post(`/api/events/${id}/builder/publish`);
  assert.equal(r.status, 422, r.text);
  assert.equal(r.json.code, 'NOT_READY');
  const codes = r.json.errors.map((e) => e.code);
  assert.ok(codes.includes('venue_missing') && codes.includes('city_missing'), codes.join(','));

  r = await buyer.patch(`/api/events/${id}/builder`, COMPLETE);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.ready, true, JSON.stringify(r.data.checklist));
  r = await buyer.post(`/api/events/${id}/builder/publish`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.event.is_published, true);
  assert.ok(r.data.event.entitlement_id, 'publishing takes the plan\'s event');
  assert.ok(r.data.event.published_at);
  assert.equal((await planOf(buyer, customerId)).eventsRemaining, 0);

  r = await buyer.patch(`/api/events/${ctx.blankEvent.id}/builder`, { ...COMPLETE, start_date: iso(30 * DAY), end_date: iso(31 * DAY), registration_start: iso(-1 * DAY), registration_end: iso(29 * DAY) });
  assert.equal(r.status, 200, r.text);
  r = await buyer.post(`/api/events/${ctx.blankEvent.id}/builder/publish`);
  assert.equal(r.status, 402, 'a per-event plan publishes one event');
  assert.equal(r.json.code, 'NO_EVENT_CREDIT');

  r = await buyer.post(`/api/events/${id}/builder/unpublish`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.event.is_published, false);
  assert.equal((await planOf(buyer, customerId)).eventsRemaining, 0, 'the credit stays with the event');
  r = await buyer.post(`/api/events/${id}/builder/publish`);
  assert.equal(r.status, 200, 'publishing again takes nothing more');
  assert.equal((await planOf(buyer, customerId)).eventsRemaining, 0);
});

test('the public page shows what is public, nothing more', async () => {
  const anon = new Session('b-anon');
  let r = await anon.get(`/api/public/events/${ctx.uniEvent.slug}`);
  assert.equal(r.status, 200, r.text);
  const e = r.data;
  assert.equal(e.name, ctx.uniEvent.name);
  assert.equal(e.registration.state, 'open');
  assert.equal(e.registration.limit, 120);
  assert.equal(e.organiser.name.startsWith('E2E b-starter Org'), true);
  assert.ok(e.tracks.length === 2 && e.prizes.length === 4 && e.criteria.length >= 1);
  for (const k of ['online_url', 'comms_config', 'certificate_config', 'judging_config', 'created_by', 'customer_id', 'entitlement_id', 'builder_state']) {
    assert.equal(k in e, false, `${k} must not be public`);
  }
  r = await anon.get(`/api/public/events/${ctx.uniEvent.event_code}`);
  assert.equal(r.status, 200, 'the registration code finds it too');
  r = await anon.get(`/api/public/events/${ctx.blankEvent.slug}`);
  assert.equal(r.status, 404, 'a draft has no public page');
});

test('registration follows the event: mode, form, eligibility, capacity, approval', async () => {
  let r = await admin.post('/api/events/drafts', { name: `Team Only ${RUN_ID}`, template: 'hackathon24', language: 'az' });
  assert.equal(r.status, 201, r.text);
  const ev = r.data.event;
  ctx.teamEvent = ev;
  const fields = r.data.fields.map((f) => ({
    id: f.id, key: f.field_key, enabled: f.enabled || f.field_key === 'age', required: f.field_key === 'age', sensitive: f.sensitive,
  }));
  r = await admin.put(`/api/events/${ev.id}/builder/form`, {
    items: [...fields, { cid: 'os', type: 'select', label: 'Laptop OS', options: ['macOS', 'Windows', 'Linux'], required: true }],
  });
  assert.equal(r.status, 200, r.text);
  const osKey = r.data.items.find((f) => f.kind === 'custom').field_key;
  r = await admin.patch(`/api/events/${ev.id}/builder`, {
    ...COMPLETE, registration_mode: 'team', max_participants: 2, waitlist_enabled: true, approval_mode: 'auto',
    eligibility: { minAge: 18 }, online_url: 'https://meet.example.com/x',
  });
  assert.equal(r.status, 200, r.text);
  r = await admin.post(`/api/events/${ev.id}/builder/publish`);
  assert.equal(r.status, 200, r.text);

  const url = `/api/public/events/${ev.slug}/register`;
  const body = (label, extra = {}) => ({
    account: { fullName: `Ələkbər Şükürova ${label}`, email: email(label), password: 'Test1234!' },
    answers: { age: 21, [osKey]: 'Linux', ...(extra.answers || {}) },
    entry: extra.entry || { type: 'lead', teamName: `Team ${label}` },
    accept: extra.accept || { rules: true, coc: true },
    ref: 'linkedin',
  });

  r = await registrant('b-solo').post(url, body('b-solo', { entry: { type: 'solo' } }));
  assert.equal(r.status, 400, 'a team-only event refuses individuals');
  assert.deepEqual(errFields(r), ['entry.type']);
  r = await registrant('b-young').post(url, body('b-young', { answers: { age: 16 } }));
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'NOT_ELIGIBLE');
  r = await registrant('b-norules').post(url, body('b-norules', { accept: { coc: true } }));
  assert.equal(r.status, 400);
  assert.ok(errFields(r).includes('accept.rules'));
  r = await registrant('b-noos').post(url, body('b-noos', { answers: { [osKey]: 'BeOS' } }));
  assert.equal(r.status, 400);
  assert.ok(errFields(r).includes(`answers.${osKey}`));

  const lead = registrant('b-lead');
  r = await lead.post(url, body('b-lead'));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.status, 'approved', 'auto approval while there is room');
  assert.equal(r.data.created, true);
  assert.ok(r.data.team.join_code);
  const code = r.data.team.join_code;
  r = await lead.get('/api/auth/me');
  assert.equal(r.status, 200, 'registering signs the new account in');
  const users = await dbQuery('SELECT full_name, age FROM users WHERE LOWER(email) = LOWER($1)', [email('b-lead')]);
  assert.equal(users.rows[0].full_name, 'Ələkbər Şükürova b-lead', 'Azerbaijani letters are kept');
  assert.equal(users.rows[0].age, 21, 'standard answers fill the profile');

  r = await registrant('b-badcode').post(url, body('b-badcode', { entry: { type: 'member', teamCode: 'nothere1' } }));
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'TEAM_NOT_FOUND');
  r = await registrant('b-member').post(url, body('b-member', { entry: { type: 'member', teamCode: code.toUpperCase() } }));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.team.name, 'Team b-lead');

  r = await registrant('b-late').post(url, body('b-late'));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.status, 'waitlisted', 'a full event puts newcomers on the waitlist');
  assert.equal(r.data.teamSkipped, true, 'no team until there is a place');

  r = await admin.patch(`/api/events/${ev.id}/builder`, { waitlist_enabled: false });
  assert.equal(r.status, 200, r.text);
  r = await registrant('b-full').post(url, body('b-full'));
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'EVENT_FULL');

  r = await registrant('b-dup').post(url, body('b-lead'));
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'EMAIL_TAKEN');

  r = await admin.post(url, body('b-admin-self'));
  assert.equal(r.status, 409, 'the organiser cannot register for their own event');
  assert.equal(r.json.code, 'ALREADY_STAFF');

  r = await admin.get(`/api/events/${ev.id}/participants`);
  assert.equal(r.status, 200, r.text);
  const me = r.data.find((p) => p.email === email('b-lead'));
  assert.equal(me.ref_source, 'linkedin');
  assert.equal(me.answers.age, 21);
  assert.equal(me.answers[osKey], 'Linux');

  // The account sign-up's old event shortcut obeys the same rules.
  r = await new Session('b-legacy').post('/api/auth/register', {
    fullName: 'Legacy Solo', email: email('b-legacy'), password: 'Test1234!', eventId: ev.id, isSolo: true,
  });
  assert.equal(r.status, 400, r.text);
  assert.ok(['TEAM_REQUIRED', 'REGISTRATION_FORM_REQUIRED'].includes(r.json.code), r.json.code);

  // A signed-in account registers with its own session, once.
  const solo = await approvedBuyer('b-existing');
  r = await admin.patch(`/api/events/${ev.id}/builder`, { registration_mode: 'both', max_participants: 10 });
  assert.equal(r.status, 200, r.text);
  r = await solo.session.post(url, { answers: { age: 30, [osKey]: 'macOS' }, entry: { type: 'solo' }, accept: { rules: true, coc: true } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.created, false);
  r = await solo.session.post(url, { answers: { age: 30, [osKey]: 'macOS' }, entry: { type: 'solo' }, accept: { rules: true, coc: true } });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'ALREADY_REGISTERED');

  r = await admin.patch(`/api/events/${ev.id}/builder`, { registration_start: iso(-3 * DAY), registration_end: iso(-1 * DAY) });
  assert.equal(r.status, 200, r.text);
  r = await registrant('b-closed').post(url, body('b-closed'));
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'REGISTRATION_CLOSED');
});

test('files: the right kind, the right size, the right people', async () => {
  // Logos: organisers of the event, image types only, public once uploaded.
  let r = await admin.post('/api/events/drafts', { name: `Files ${RUN_ID}`, template: 'blank' });
  assert.equal(r.status, 201, r.text);
  const ev = r.data.event;
  ctx.filesEvent = ev;
  r = await admin.upload(`/api/files?purpose=event_logo&eventId=${ev.id}`, PNG, { type: 'image/png', name: 'logo.png' });
  assert.equal(r.status, 201, r.text);
  const logo = r.data;
  assert.equal(logo.mime, 'image/png');
  r = await admin.patch(`/api/events/${ev.id}/builder`, { logo_file_id: logo.id });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.event.logo_url, `/api/files/${logo.id}`);
  const pub = await new Session('b-anon-file').download(`/api/files/${logo.id}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.headers.get('content-type'), 'image/png');
  assert.equal(pub.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(pub.body.equals(PNG), 'the same bytes come back');

  r = await admin.upload(`/api/files?purpose=event_logo&eventId=${ev.id}`, Buffer.from('<svg onload=alert(1)></svg>'), { type: 'image/png', name: 'x.png' });
  assert.equal(r.status, 415, 'what a file is comes from its bytes');
  const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024 + 10)]);
  r = await admin.upload(`/api/files?purpose=event_logo&eventId=${ev.id}`, big, { type: 'image/png', name: 'big.png' });
  assert.equal(r.status, 413);
  r = await ctx.other.session.upload(`/api/files?purpose=event_logo&eventId=${ev.id}`, PNG, { type: 'image/png' });
  assert.equal(r.status, 404, 'another organisation cannot upload into this event');
  r = await ctx.buyer.session.upload(`/api/files?purpose=event_logo&eventId=${ctx.uniEvent.id}`, PNG, { type: 'image/png' });
  assert.equal(r.status, 403, 'logos are branding, not part of Starter');
  r = await ctx.buyer.session.patch(`/api/events/${ctx.uniEvent.id}/builder`, { logo_file_id: logo.id });
  assert.equal(r.status, 403);

  // Registration attachments: anyone filling in an open form; claimed with a token; private.
  r = await new Session('b-anon-draft').upload(`/api/files?purpose=registration&eventId=${ev.id}`, PDF, { type: 'application/pdf', name: 'cv.pdf' });
  assert.equal(r.status, 403, 'a draft takes no uploads from strangers');

  r = await admin.get(`/api/events/${ev.id}/builder`);
  const fields = r.data.fields.map((f) => ({ id: f.id, key: f.field_key, enabled: f.enabled || f.field_key === 'cv', required: f.field_key === 'cv', sensitive: f.sensitive }));
  r = await admin.put(`/api/events/${ev.id}/builder/form`, { items: fields });
  assert.equal(r.status, 200, r.text);
  r = await admin.patch(`/api/events/${ev.id}/builder`, { ...COMPLETE, registration_start: iso(-1 * DAY), registration_end: iso(20 * DAY), start_date: iso(25 * DAY), end_date: iso(26 * DAY) });
  assert.equal(r.status, 200, r.text);
  r = await admin.post(`/api/events/${ev.id}/builder/publish`);
  assert.equal(r.status, 200, r.text);

  const applicant = new Session('b-cv');
  r = await applicant.upload(`/api/files?purpose=registration&eventId=${ev.id}`, PDF, { type: 'application/pdf', name: 'Mənim CV.pdf' });
  assert.equal(r.status, 201, r.text);
  const cv = r.data;
  assert.ok(cv.claimToken, 'a token to claim it with');
  r = await new Session('b-peek').download(`/api/files/${cv.id}`);
  assert.equal(r.status, 404, 'a registration attachment is private');

  r = await new Session('b-thief').post(`/api/public/events/${ev.slug}/register`, {
    account: { fullName: 'Thief', email: email('b-thief'), password: 'Test1234!' },
    answers: { cv: { fileId: cv.id, claimToken: 'not-the-token' } }, entry: { type: 'solo' }, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 400, 'someone else\'s upload cannot be claimed');
  assert.equal(r.json.code, 'FILE_NOT_FOUND');

  r = await applicant.post(`/api/public/events/${ev.slug}/register`, {
    account: { fullName: 'CV Person', email: email('b-cv'), password: 'Test1234!' },
    answers: { cv: { fileId: cv.id, claimToken: cv.claimToken } }, entry: { type: 'solo' }, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  r = await applicant.download(`/api/files/${cv.id}`);
  assert.equal(r.status, 200, 'the uploader reads their own file');
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  r = await admin.download(`/api/files/${cv.id}`);
  assert.equal(r.status, 200, 'the organiser reads it');
  r = await ctx.other.session.download(`/api/files/${cv.id}`);
  assert.equal(r.status, 404, 'another organisation does not');
});

test('another organisation reaches none of the builder', async () => {
  const other = ctx.other.session;
  const id = ctx.uniEvent.id;
  for (const [method, path, body] of [
    ['get', `/api/events/${id}/builder`],
    ['patch', `/api/events/${id}/builder`, { tagline: 'pwned' }],
    ['put', `/api/events/${id}/builder/tracks`, { items: [] }],
    ['put', `/api/events/${id}/builder/form`, { items: [] }],
    ['post', `/api/events/${id}/builder/publish`, {}],
    ['post', `/api/events/${id}/builder/unpublish`, {}],
  ]) {
    const r = await other[method](path, body);
    assert.equal(r.status, 404, `${method.toUpperCase()} ${path} → ${r.status}`);
  }
  const r = await ctx.buyer.session.get(`/api/events/${id}/builder`);
  assert.equal(r.data.event.tagline, COMPLETE.tagline, 'nothing changed');
});

test('judges, mentors and volunteers do not see sensitive answers', async () => {
  const ev = ctx.teamEvent;
  const mentor = await approvedBuyer('b-mentor');
  let r = await admin.post(`/api/events/${ev.id}/invites`, { email: email('b-mentor'), role: 'mentor', meta: { expertise: 'ML' } });
  assert.equal(r.status, 201, r.text);
  mentor.session.cookies.set('hh_event', String(ev.id));
  r = await mentor.session.get(`/api/events/${ev.id}/participants`);
  assert.equal(r.status, 200, r.text);
  const row = r.data.find((p) => p.email === email('b-lead'));
  assert.ok(row);
  assert.equal(row.phone, undefined, 'no phone number for staff');
  assert.equal(row.answers.age, undefined, 'age is sensitive');
  r = await admin.get(`/api/events/${ev.id}/participants`);
  assert.equal(r.data.find((p) => p.email === email('b-lead')).answers.age, 21, 'the organiser sees it');
  r = await admin.get(`/api/events/${ev.id}/mentors`);
  assert.equal(r.data.find((m) => m.email === email('b-mentor'))?.expertise, 'ML', 'the invite\'s note reaches the mentor row');
});

test('a resource can wait for its moment', async () => {
  const ev = ctx.teamEvent;
  let r = await admin.post(`/api/events/${ev.id}/resources`, { label: 'Dataset', url: 'https://example.com/data', visible_from: iso(5 * DAY) });
  assert.equal(r.status, 201, r.text);
  r = await admin.post(`/api/events/${ev.id}/resources`, { label: 'Wiki', url: 'https://example.com/wiki' });
  assert.equal(r.status, 201, r.text);
  const lead = new Session('b-lead-res');
  await lead.login(email('b-lead'));
  r = await lead.get(`/api/events/${ev.id}/resources`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.map((x) => x.label), ['Wiki'], 'the dataset is hidden until its time');
  r = await admin.get(`/api/events/${ev.id}/resources`);
  assert.deepEqual(r.data.map((x) => x.label).sort(), ['Dataset', 'Wiki']);

  // A date that does not parse is refused, never read as "no embargo".
  const dataset = r.data.find((x) => x.label === 'Dataset');
  r = await admin.patch(`/api/events/${ev.id}/resources/${dataset.id}`, { visible_from: 'not-a-date' });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'INVALID_DATE');
  r = await admin.post(`/api/events/${ev.id}/resources`, { label: 'Keys', url: 'https://example.com/keys', visible_from: 'soon' });
  assert.equal(r.status, 400, r.text);
  r = await admin.put(`/api/events/${ev.id}/resources/bulk`, { items: [{ label: 'Wiki', url: 'https://example.com/wiki', visible_from: '31/31/2026' }] });
  assert.equal(r.status, 400, r.text);
  r = await lead.get(`/api/events/${ev.id}/resources`);
  assert.deepEqual(r.data.map((x) => x.label), ['Wiki'], 'the dataset still waits, and nothing was replaced');
});

test('university search: the official Azerbaijani list first, the world after', async () => {
  const anon = new Session('b-uni');
  let r = await anon.get('/api/universities?q=bdu');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data[0].name, 'Bakı Dövlət Universiteti');
  r = await anon.get('/api/universities?q=xezer');
  assert.equal(r.data[0].name, 'Xəzər Universiteti', 'typing without Azerbaijani letters finds it');
  r = await anon.get('/api/universities?q=stanford');
  assert.ok(r.data.some((u) => u.name === 'Stanford University' && u.country === 'US'));
  r = await anon.get('/api/universities');
  assert.equal(r.data.length, 59, 'the whole official list');
});

test('cleanup', async () => {
  for (const ev of [ctx.teamEvent, ctx.filesEvent]) {
    if (ev) await admin.delete(`/api/events/${ev.id}`);
  }
  const owner = await ownerSession();
  for (const ev of [ctx.uniEvent, ctx.blankEvent]) {
    if (ev) await owner.delete(`/api/events/${ev.id}`);
  }
});
