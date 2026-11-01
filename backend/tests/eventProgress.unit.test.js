/**
 * A participant's stages and next step, from their event's timeline and
 * their own state.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { compute } = require('../src/services/eventProgress.service');

const H = 3600e3;
const NOW = Date.UTC(2026, 10, 1, 10, 0);
const at = (h) => new Date(NOW + h * H).toISOString();
const row = (o = {}) => ({
  id: 1, registration_mode: 'both', registration_end: at(-24), team_deadline: null,
  start_date: at(24), end_date: at(48), submission_deadline: at(46), judging_start: null, judging_end: null,
  demo_day: at(47), results_at: at(50), allow_team_formation: true, allow_late_submissions: false,
  participant_status: 'approved', team_id: null, team_name: null, team_status: '', is_leader: null, team_size: 0,
  submission_id: null, ...o,
});
const stateOf = (p, key) => p.stages.find((s) => s.key === key).state;

test('pending, waitlisted and rejected people are told where they stand', () => {
  assert.equal(compute(row({ participant_status: 'pending' }), NOW).next.code, 'wait_approval');
  assert.equal(compute(row({ participant_status: 'waitlisted' }), NOW).next.code, 'waitlisted');
  const rejected = compute(row({ participant_status: 'rejected' }), NOW);
  assert.equal(rejected.next.code, 'rejected');
  assert.equal(stateOf(rejected, 'registration'), 'missed');
});

test('admitted without a team: find one while formation is open', () => {
  const p = compute(row(), NOW);
  assert.equal(stateOf(p, 'registration'), 'done');
  assert.equal(stateOf(p, 'team'), 'current');
  assert.equal(p.next.code, 'find_team');
  assert.equal(compute(row({ registration_mode: 'solo' }), NOW).next.code, 'wait_start', 'solo events skip the team step');
});

test('in a team before the start: wait; during hacking: the lead submits', () => {
  const team = { team_id: 7, team_name: 'Kod Ustaları', is_leader: true, team_size: 3 };
  assert.equal(compute(row(team), NOW).next.code, 'wait_start');
  const hacking = NOW + 30 * H;
  const lead = compute(row(team), hacking);
  assert.equal(stateOf(lead, 'hacking'), 'current');
  assert.equal(lead.next.code, 'submit');
  assert.equal(compute(row({ ...team, is_leader: false }), hacking).next.code, 'lead_submits');
  const done = compute(row({ ...team, submission_id: 3 }), hacking);
  assert.equal(stateOf(done, 'submission'), 'done');
  assert.equal(done.next.code, 'update_submission');
});

test('after the deadline: pitch, results, or a missed submission', () => {
  const team = { team_id: 7, is_leader: true, team_size: 2 };
  assert.equal(compute(row({ ...team, submission_id: 3 }), NOW + 46.5 * H).next.code, 'prepare_pitch');
  assert.equal(compute(row({ ...team, submission_id: 3 }), NOW + 51 * H).next.code, 'wait_results', 'the planned date passed, nothing published');
  const out = compute(row({ ...team, submission_id: 3, results_published_at: at(49) }), NOW + 51 * H);
  assert.equal(out.next.code, 'see_results');
  assert.equal(out.next.href, '/hacker/results');
  assert.equal(stateOf(out, 'results'), 'current');
  assert.equal(stateOf(out, 'judging'), 'done');
  assert.equal(compute(row({ ...team, results_published_at: at(49) }), NOW + 51 * H).next.code, 'see_results', 'without a project too');
  const missed = compute(row(team), NOW + 46.5 * H);
  assert.equal(stateOf(missed, 'submission'), 'missed');
  assert.equal(missed.next.code, 'missed_submission');
});

test('eliminated teams see the elimination page', () => {
  assert.equal(compute(row({ team_id: 7, team_status: 'eliminated' }), NOW).next.code, 'eliminated');
});
