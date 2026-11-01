/**
 * The post-event report end to end: the figures of a finished event (the
 * funnel, who came, judging, winners, NPS, sponsors) as data and as a PDF in
 * three languages; ready only once the event is over; aggregates only (no
 * names, e-mails, phones or written feedback anywhere); for the event's
 * organisers only; a plan feature from Professional up ('reports'), which
 * the platform owner can switch off for one organisation.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { PDFDocument } = require('pdf-lib');
const { Session, RUN_ID, DAY, iso } = require('./helpers');
const { approvedBuyer, ownerSession } = require('./fixtures');
const { finishedEvent } = require('./finishedEvent');

const admin = new Session('rp-admin');
let ctx;
const url = (id = ctx.ev.id, rest = '') => `/api/events/${id}/report${rest}`;

function walk(value, keys = new Set(), strings = []) {
  if (Array.isArray(value)) value.forEach((v) => walk(v, keys, strings));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { keys.add(k); walk(v, keys, strings); }
  } else if (value != null) strings.push(String(value));
  return { keys, strings };
}

test('setup: a finished event', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  ctx = await finishedEvent(admin, 'rp');
});

test('the figures: funnel, judging, winners, feedback, sponsors', async () => {
  const r = await admin.get(url(ctx.ev.id, '?lang=en'));
  assert.equal(r.status, 200, r.text);
  const d = r.data;
  assert.equal(d.language, 'en');
  assert.deepEqual(
    { ...d.funnel },
    { registrations: 6, approved: 4, waitlisted: 1, pending: 0, rejected: 1, checkedIn: 3, inTeams: 4, teams: 2, projects: 2 },
  );
  assert.equal(d.judging.judges, 1);
  assert.equal(d.judging.reviews, 2);
  assert.equal(d.judging.projectsReviewed, 2);
  assert.deepEqual(d.judging.criteria.map((c) => c.name), ['Quality']);
  assert.equal(d.winners.published, true);
  const grand = d.winners.items.find((x) => x.prize === 'Grand prize');
  assert.equal(grand.team, ctx.teams.x.name);
  assert.equal(grand.project, ctx.teams.x.project);
  assert.equal(d.winners.items.find((x) => x.prize === 'Best design').team, ctx.teams.y.name);
  assert.deepEqual(d.feedback.nps, { responses: 4, score: 25, promoters: 2, passives: 1, detractors: 1 });
  assert.deepEqual(d.sponsors, [{ name: 'Sponsor rp', tier: 'gold' }]);
  assert.ok(d.timeline.some((t) => t.key === 'start') && d.timeline.some((t) => t.key === 'results'));
  assert.ok(d.registrationsByDay.reduce((s, x) => s + x.n, 0) === 6);
});

test('who came: the event’s own answers, small groups folded into "Other", refused registrations left out', async () => {
  const { demographics, privacy } = (await admin.get(url())).data;
  assert.equal(privacy.minGroup, 3);
  // Five answers count (the refused registration does not): four from one university, one from another.
  assert.equal(demographics.university.total, 5);
  assert.deepEqual(demographics.university.items.map((x) => [x.label, x.n]), [['ADA Universiteti', 4]]);
  assert.equal(demographics.university.other, 1, 'the single answer is not named');
  assert.deepEqual(demographics.city.items.map((x) => [x.label, x.n]), [['Bakı', 5]]);
  assert.ok(!('phone' in demographics), 'a phone number is never a demographic');
});

test('aggregates only: no names, e-mails, phones or written feedback', async () => {
  const r = await admin.get(url());
  const { keys, strings } = walk(r.json);
  for (const k of ['email', 'phone', 'full_name', 'fullName', 'comment', 'comments', 'user_id', 'userId', 'members']) {
    assert.ok(!keys.has(k), `key ${k} must not be in the report`);
  }
  const all = strings.join('\n');
  for (const p of Object.values(ctx.people)) {
    assert.ok(!all.includes(p.name), `${p.name} is named in the report`);
    assert.ok(!all.includes(p.email), `${p.email} is in the report`);
  }
  assert.ok(!all.includes('Judge rp'), 'a judge is named');
  assert.ok(!all.includes('Private comment'), 'written feedback leaked');
  assert.ok(!all.includes('+994'), 'a phone number leaked');
});

test('the PDF: a real document in each language, with nobody named in its text', async () => {
  for (const lang of ['az', 'en', 'ru']) {
    // eslint-disable-next-line no-await-in-loop
    const res = await admin.download(url(ctx.ev.id, `/pdf?lang=${lang}`));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition'), new RegExp(`attachment; filename="report-.*-${lang}\\.pdf"`));
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.equal(res.body.subarray(0, 5).toString(), '%PDF-');
    // eslint-disable-next-line no-await-in-loop
    const doc = await PDFDocument.load(res.body);
    assert.ok(doc.getPageCount() >= 3, `${lang}: ${doc.getPageCount()} pages`);
    // With poppler at hand, read the text back and look for people.
    const text = spawnSync('pdftotext', ['-', '-'], { input: res.body });
    if (text.status === 0) {
      const out = text.stdout.toString();
      assert.ok(out.includes(ctx.teams.x.project), `${lang}: the winning project is in the report`);
      for (const p of Object.values(ctx.people)) assert.ok(!out.includes(p.name), `${lang}: ${p.name} is in the PDF`);
      assert.ok(!/@/.test(out), `${lang}: an e-mail address is in the PDF`);
    }
  }
  const inline = await admin.download(url(ctx.ev.id, '/pdf?inline=1'));
  assert.match(inline.headers.get('content-disposition'), /^inline;/);
});

test('ready once the event is over', async () => {
  const r = await admin.post('/api/events', {
    event_code: `RPS${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `Report soon ${RUN_ID}`,
    registration_start: iso(-DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  for (const rest of ['', '/pdf']) {
    // eslint-disable-next-line no-await-in-loop
    const x = await admin.get(url(r.data.id, rest));
    assert.equal(x.status, 409, x.text);
    assert.equal(x.json.code, 'EVENT_NOT_OVER');
  }
});

test('for the event’s organisers only', async () => {
  const anon = new Session('rp-anon');
  assert.ok([401, 404].includes((await anon.get(url())).status));
  assert.ok([401, 404].includes((await anon.download(url(ctx.ev.id, '/pdf'))).status));
  // A participant of the event.
  let r = await ctx.people.a.s.get(url());
  assert.ok([403, 404].includes(r.status), r.text);
  // Another organisation's organiser.
  const other = await approvedBuyer('rp-other', { plan: 'business' });
  r = await other.session.get(url());
  assert.equal(r.status, 404, r.text);
  r = await other.session.download(url(ctx.ev.id, '/pdf'));
  assert.equal(r.status, 404);
});

test('a plan feature: not on Starter, on Professional, and switchable per organisation', async () => {
  const starter = await approvedBuyer('rp-starter', { plan: 'starter' });
  let r = await starter.session.post('/api/events/drafts', { name: `Starter report ${RUN_ID}`, template: 'university', language: 'az' });
  assert.equal(r.status, 201, r.text);
  const starterEvent = r.data.event.id;
  r = await starter.session.get(url(starterEvent));
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'MODULE_DISABLED');
  assert.equal(r.json.module, 'reports');
  r = await starter.session.get(`/api/events/${starterEvent}/modules`);
  assert.ok(!r.data.modules.includes('reports'));

  const pro = await approvedBuyer('rp-pro', { plan: 'professional' });
  r = await pro.session.post('/api/events/drafts', { name: `Pro report ${RUN_ID}`, template: 'university', language: 'az' });
  assert.equal(r.status, 201, r.text);
  const proEvent = r.data.event.id;
  r = await pro.session.get(`/api/events/${proEvent}/modules`);
  assert.ok(r.data.modules.includes('reports'));
  r = await pro.session.get(url(proEvent));
  assert.equal(r.status, 409, 'the module is there; the event is just not over');

  const owner = await ownerSession();
  r = await owner.put(`/api/customers/${pro.customerId}/modules/reports`, { enabled: false });
  assert.equal(r.status, 200, r.text);
  r = await pro.session.get(url(proEvent));
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'MODULE_DISABLED');
  r = await owner.put(`/api/customers/${pro.customerId}/modules/reports`, { enabled: null });
  assert.equal(r.status, 200, r.text);
  assert.equal((await pro.session.get(url(proEvent))).status, 409);
  // The owner's console lists the module with the plans that include it.
  r = await owner.get(`/api/customers/${pro.customerId}/plan`);
  assert.equal(r.status, 200, r.text);
  assert.ok(JSON.stringify(r.data).includes('reports'));
});
