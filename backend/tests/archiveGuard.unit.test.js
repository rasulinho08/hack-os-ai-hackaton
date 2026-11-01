/**
 * Which requests the archive guard checks, and against which event: writes
 * only, on the paths that belong to an event, with the event named by the
 * path, by a row id, by the body or query, by a team's join code or by the
 * event code or page a person signs up with. Reads, sessions, billing and
 * the few writes an archived event allows are left alone.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { targets } = require('../src/middlewares/archiveGuard');

const shape = (method, path, body, query) => targets(method, path, body, query).map((t) => [t.sql.split(' FROM ')[1]?.split(' ')[0] || 'id', t.params, Boolean(t.open)]);

test('reads and requests outside events are never checked', () => {
  assert.deepEqual(targets('GET', '/api/events/5/builder'), []);
  assert.deepEqual(targets('GET', '/api/events/5/export.zip'), []);
  assert.deepEqual(targets('POST', '/api/auth/login', { eventId: 5 }), []);
  assert.deepEqual(targets('POST', '/api/checkout', { eventId: 5 }), []);
  assert.deepEqual(targets('PATCH', '/api/users/7', { eventId: 5 }), []);
  assert.deepEqual(targets('POST', '/api/me/whatever', { eventId: 5 }), []);
  assert.deepEqual(targets('POST', '/api/events'), [], 'creating an event names none');
  assert.deepEqual(targets('POST', '/api/events/drafts'), []);
});

test('what an archived event still allows', () => {
  assert.deepEqual(targets('POST', '/api/events/5/unarchive'), []);
  assert.deepEqual(targets('POST', '/api/events/5/archive'), []);
  assert.deepEqual(targets('DELETE', '/api/events/5'), []);
  assert.deepEqual(targets('POST', '/api/events/5/certificates/email', { ids: [1] }), []);
  assert.deepEqual(targets('POST', '/api/events/5/mentors/me/heartbeat'), []);
  assert.notDeepEqual(targets('POST', '/api/events/5/certificates/issue'), [], 'issuing is a change');
  assert.notDeepEqual(targets('PUT', '/api/events/5'), []);
});

test('the event in the path, in a row, in the body or the query', () => {
  assert.deepEqual(shape('PATCH', '/api/events/12/builder', {}), [['id', [12], false]]);
  assert.deepEqual(shape('POST', '/api/events/12/judging/me/reviews', {}), [['id', [12], false]]);
  assert.deepEqual(shape('PUT', '/api/teams/40', {}), [['teams', ['40'], false]]);
  assert.deepEqual(shape('POST', '/api/teams/requests/9/accept', {}), [['team_join_requests', ['9'], false]]);
  assert.deepEqual(shape('PATCH', '/api/tickets/3/claim', {}), [['help_tickets', ['3'], false]]);
  assert.deepEqual(shape('PUT', '/api/submissions/8', {}), [['submissions', ['8'], false]]);
  assert.deepEqual(shape('DELETE', '/api/announcements/2', {}), [['announcements', ['2'], false]]);
  assert.deepEqual(shape('POST', '/api/team-invites/6/accept', {}), [['team_invites', ['6'], false]]);
  const file = '0b0e4c1e-1111-4222-8333-444455556666';
  assert.deepEqual(shape('DELETE', `/api/files/${file}`, {}), [['files', [file], false]]);
  assert.deepEqual(shape('POST', '/api/teams', { eventId: 12 }), [['id', [12], false]]);
  assert.deepEqual(shape('POST', '/api/submissions', { event_id: '12' }), [['id', [12], false]]);
  assert.deepEqual(shape('POST', '/api/files', {}, { eventId: '12', purpose: 'event_logo' }), [['id', [12], false]]);
  assert.deepEqual(shape('POST', '/api/mail/staff-invite', { eventId: 12 }), [['id', [12], false]]);
  assert.deepEqual(shape('POST', '/api/teams', { eventId: '12; DROP TABLE events' }), [], 'not a number, not used');
  assert.deepEqual(shape('POST', '/api/teams', { eventId: '012' }), []);
});

test('joining a team by code and signing up name the event another way', () => {
  assert.deepEqual(shape('POST', '/api/teams/join', { joinCode: 'ABC123' }), [['teams', ['ABC123'], false]]);
  assert.deepEqual(shape('POST', '/api/auth/register', { eventCode: 'HACK26' }), [['events', ['HACK26'], true]]);
  assert.deepEqual(shape('POST', '/api/auth/register', { eventId: 12 }), [['id', [12], true]], 'refused for everyone');
  assert.deepEqual(shape('POST', '/api/auth/register', { email: 'a@b.c' }), []);
  assert.deepEqual(shape('POST', '/api/public/events/baku-hack/register', {}), [['events', ['baku-hack'], true]]);
  assert.deepEqual(shape('POST', '/api/public/events/%E2%9C%93/register', {}), [['events', ['✓'], true]]);
  assert.deepEqual(shape('POST', '/api/public/events/%E0%A4%A/register', {}), [['events', ['%E0%A4%A'], true]], 'a broken escape is kept as typed');
});
