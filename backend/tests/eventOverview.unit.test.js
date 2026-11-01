/**
 * The organiser home's rules without a database: which phase the dates put
 * the event in, the milestones in order, and which alerts fire.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { phaseOf, milestonesOf, alertsFor, formationOf } = require('../src/services/eventOverview.service');

const H = 3600e3;
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const at = (h) => new Date(NOW + h * H).toISOString();

const event = (over = {}) => ({
  id: 7,
  status: 'upcoming',
  is_published: true,
  registration_start: at(-48),
  registration_end: at(24),
  team_deadline: null,
  start_date: at(48),
  end_date: at(72),
  submission_deadline: null,
  judging_start: null,
  judging_end: null,
  demo_day: null,
  results_at: null,
  allow_team_formation: true,
  registration_mode: 'both',
  ...over,
});

const kpis = (over = {}) => ({
  participants: { byStatus: { waitlisted: 0 }, capacity: { full: false }, pendingOld: 0, ...over.participants },
  teams: { withoutSubmission: 0, teamlessApproved: 0, ...over.teams },
  help: { open: 0, flagged: 0, waitingLong: 0, oldestOpenAt: null, ...over.help },
  mentors: { online: 0, ...over.mentors },
  volunteers: { tasksOverdue: 0, ...over.volunteers },
  announcements: { failed24h: 0, ...over.announcements },
});

test('the phase follows the dates, and drafts and archives are what the organiser made them', () => {
  assert.equal(phaseOf(event({ status: 'archived' }), NOW).key, 'archived');
  assert.equal(phaseOf(event({ is_published: false }), NOW).key, 'draft');
  assert.equal(phaseOf(event({ registration_start: at(2) }), NOW).key, 'upcoming');
  assert.deepEqual(phaseOf(event(), NOW), { key: 'registration', until: at(24) });
  assert.equal(phaseOf(event({ registration_end: at(-1) }), NOW).key, 'before_start');
  assert.deepEqual(phaseOf(event({ start_date: at(-1), submission_deadline: at(3) }), NOW), { key: 'hacking', until: at(3) });
  // Without a submission deadline the end of the event is the deadline.
  assert.equal(phaseOf(event({ start_date: at(-5), end_date: at(-1) }), NOW).key, 'ended');
  assert.deepEqual(
    phaseOf(event({ start_date: at(-5), end_date: at(-1), judging_start: at(-0.5) }), NOW),
    { key: 'judging', until: at(5.5) },
    'judging lasts six hours when no end is set',
  );
  assert.equal(phaseOf(event({ start_date: at(-5), end_date: at(-1), results_at: at(2) }), NOW).key, 'judging');
  // Results are out when they are published, whatever the results date says.
  assert.equal(phaseOf(event({ start_date: at(-5), end_date: at(-1), results_at: at(-0.1) }), NOW).key, 'judging', 'the date passed, nothing published');
  assert.equal(phaseOf(event({ start_date: at(-5), end_date: at(-1), results_published_at: at(-0.5) }), NOW).key, 'results');
  assert.equal(phaseOf(event({ start_date: at(-5), end_date: at(-1), judging_end: at(3), results_published_at: at(-0.5) }), NOW).key, 'results', 'published early: out');
  // No dates at all: registration stays open.
  assert.equal(phaseOf(event({ registration_start: null, registration_end: null, start_date: null, end_date: null }), NOW).key, 'registration');
});

test('milestones come in time order with the next one marked', () => {
  const { milestones, next } = milestonesOf(event({ team_deadline: at(40), results_at: at(80) }), NOW);
  assert.deepEqual(milestones.map((m) => m.key), ['registration_opens', 'registration_closes', 'team_deadline', 'start', 'end', 'results']);
  assert.deepEqual(milestones.map((m) => m.state), ['done', 'next', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  assert.deepEqual(next, { key: 'registration_closes', at: at(24) });
  assert.equal(milestonesOf(event({ registration_start: null, registration_end: null, start_date: at(-3), end_date: at(-1) }), NOW).next, null);
});

test('team formation closes at the team deadline, else at the start; solo events have none', () => {
  assert.deepEqual(formationOf(event(), NOW), { open: true, closesAt: at(48) });
  assert.deepEqual(formationOf(event({ team_deadline: at(-1) }), NOW), { open: false, closesAt: at(-1) });
  assert.deepEqual(formationOf(event({ registration_mode: 'solo' }), NOW), { open: false, closesAt: null });
  assert.deepEqual(formationOf(event({ allow_team_formation: false }), NOW), { open: false, closesAt: null });
});

test('alerts fire only when there is something to do, the most urgent first', () => {
  const e = event();
  assert.deepEqual(alertsFor(e, kpis(), phaseOf(e, NOW), NOW), []);

  const busy = alertsFor(e, kpis({
    help: { open: 3, flagged: 1, waitingLong: 2, oldestOpenAt: at(-1) },
    participants: { pendingOld: 4, capacity: { full: true }, byStatus: { waitlisted: 5 } },
    volunteers: { tasksOverdue: 1 },
    announcements: { failed24h: 2 },
  }), phaseOf(e, NOW), NOW);
  assert.deepEqual(busy.map((a) => [a.code, a.severity, a.count]), [
    ['help_flagged', 'danger', 1],
    ['help_waiting', 'danger', 2],
    ['no_mentor_online', 'warn', 3],
    ['pending_old', 'warn', 4],
    ['tasks_overdue', 'warn', 1],
    ['delivery_failures', 'warn', 2],
    ['full_waitlist', 'info', 5],
  ]);
  assert.equal(busy.find((a) => a.code === 'help_waiting').since, at(-1));
  assert.equal(busy.find((a) => a.code === 'pending_old').href, '/participants?status=pending');

  // A mentor online: requests still wait, but someone can take them.
  const covered = alertsFor(e, kpis({ help: { open: 3 }, mentors: { online: 1 } }), phaseOf(e, NOW), NOW);
  assert.equal(covered.find((a) => a.code === 'no_mentor_online'), undefined);
});

test('deadline alerts: projects in the last three hours, teams in the last day', () => {
  const hacking = event({ start_date: at(-10), submission_deadline: at(2), end_date: at(2) });
  const k = kpis({ teams: { withoutSubmission: 3, teamlessApproved: 2 } });
  const near = alertsFor(hacking, k, phaseOf(hacking, NOW), NOW);
  assert.deepEqual(near.find((a) => a.code === 'teams_without_submission'), {
    code: 'teams_without_submission', severity: 'warn', count: 3, href: '/submissions', at: at(2),
  });
  const early = event({ start_date: at(-10), submission_deadline: at(5), end_date: at(5) });
  assert.equal(alertsFor(early, k, phaseOf(early, NOW), NOW).find((a) => a.code === 'teams_without_submission'), undefined);

  const teamsSoon = event({ team_deadline: at(10) });
  assert.equal(alertsFor(teamsSoon, k, phaseOf(teamsSoon, NOW), NOW).find((a) => a.code === 'teamless_near_deadline').count, 2);
  assert.equal(alertsFor(event(), k, phaseOf(event(), NOW), NOW).find((a) => a.code === 'teamless_near_deadline'), undefined, 'two days away is not urgent');
  const solo = event({ team_deadline: at(10), registration_mode: 'solo' });
  assert.equal(alertsFor(solo, k, phaseOf(solo, NOW), NOW).find((a) => a.code === 'teamless_near_deadline'), undefined);
});

test('a draft asks to be published; finished events stop asking about registrations', () => {
  const draft = event({ is_published: false });
  assert.deepEqual(alertsFor(draft, kpis(), phaseOf(draft, NOW), NOW), [
    { code: 'not_published', severity: 'info', count: 1, href: '/create-event/7' },
  ]);
  const done = event({ start_date: at(-10), end_date: at(-5), results_at: at(-1) });
  assert.deepEqual(alertsFor(done, kpis({ participants: { pendingOld: 3 } }), phaseOf(done, NOW), NOW), []);
});

test('the late phases need attention too: judging, results, certificates, reports', () => {
  const over = event({ start_date: at(-30), end_date: at(-2), submission_deadline: at(-3), judging_start: at(-2), judging_end: at(4), results_at: at(6) });
  const judges = [
    { id: 1, name: 'Aysel', assigned: 4, done: 4, partial: 0 },
    { id: 2, name: 'Murad', assigned: 4, done: 1, partial: 1 },
    { id: 3, name: 'Nigar', assigned: 4, done: 0, partial: 0 },
  ];
  const k = (over2 = {}) => ({ ...kpis(), judging: { closed: true, started: true, judges, submissions: 4 }, results: { published: false }, ...over2 });
  const a = alertsFor(over, k(), phaseOf(over, NOW), NOW);
  const unfinished = a.find((x) => x.code === 'judging_unfinished');
  assert.ok(unfinished, JSON.stringify(a));
  assert.equal(unfinished.count, 2, 'one line per judge with work left');
  assert.deepEqual(unfinished.judges.map((x) => [x.name, x.todo, x.partial, x.of]), [['Murad', 2, 1, 4], ['Nigar', 4, 0, 4]]);
  assert.equal(unfinished.href, '/judges');
  assert.equal(a.find((x) => x.code === 'results_not_published').severity, 'info', 'judges still at work');

  // Judging over: everyone done, the results wait for the organiser.
  const done = k({ judging: { closed: true, started: true, judges: judges.map((x) => ({ ...x, done: x.assigned, partial: 0 })), submissions: 4 } });
  const ready = alertsFor(over, done, phaseOf(over, NOW), NOW);
  assert.equal(ready.find((x) => x.code === 'judging_unfinished'), undefined);
  assert.deepEqual(ready.map((x) => [x.code, x.severity]), [['results_not_published', 'warn']]);
  // The results date passed: urgent.
  const lateNow = NOW + 7 * H;
  assert.equal(alertsFor(over, k(), phaseOf(over, lateNow), lateNow).find((x) => x.code === 'judging_unfinished').severity, 'danger');
  assert.equal(alertsFor(over, done, phaseOf(over, lateNow), lateNow).find((x) => x.code === 'results_not_published').severity, 'danger');

  // Projects in, nobody to judge them.
  assert.ok(alertsFor(over, k({ judging: { closed: true, started: true, judges: [], submissions: 3 } }), phaseOf(over, NOW), NOW).some((x) => x.code === 'no_judges'));

  // Published: certificates without a signer, or not issued.
  const pub = { ...over, results_published_at: at(-1) };
  const certs = (c) => ({ ...kpis(), judging: { closed: true, started: true, judges: [], submissions: 0 }, results: { published: true }, certificates: { enabled: true, kinds: 2, signer: true, issued: 5, issuing: false, ...c } });
  assert.deepEqual(alertsFor(pub, certs(), phaseOf(pub, NOW), NOW), [], 'issued with a signer: nothing to do');
  assert.deepEqual(alertsFor(pub, certs({ signer: false, issued: 0 }), phaseOf(pub, NOW), NOW).map((x) => [x.code, x.severity, x.href]), [['certificate_signer_missing', 'danger', '/create-event/7?section=certificates']]);
  assert.deepEqual(alertsFor(pub, certs({ issued: 0 }), phaseOf(pub, NOW), NOW).map((x) => x.code), ['certificates_not_issued']);
  assert.deepEqual(alertsFor(pub, certs({ issued: 0, issuing: true }), phaseOf(pub, NOW), NOW), [], 'being issued now');

  // Reported chat messages, in any phase.
  assert.deepEqual(alertsFor(event(), { ...kpis(), chat: { openReports: 2 } }, phaseOf(event(), NOW), NOW).map((x) => [x.code, x.count, x.href]), [['chat_reports', 2, '/chat?tab=reports']]);
});
