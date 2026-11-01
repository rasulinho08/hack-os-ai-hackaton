/**
 * The invitation rules that need no server: the organiser's list checked
 * and de-duplicated, an invitation's status, and the link's signature bound
 * to the address and the nonce.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret';
const { parseInvitees, statusOf } = require('../src/services/participantInvite.service');
const tokens = require('../src/services/inviteToken');

test('a pasted list: trimmed, lower-cased, duplicates kept once, bad addresses said', () => {
  const out = parseInvitees([
    ' Aysel@Example.COM ', 'aysel@example.com', { email: 'b@example.com', fullName: '  Bəhruz   Ə ', team: ' Owls ' },
    'nope', 'a@b', { email: 'x@example.com', fullName: '<script>' }, '', null, { email: 'c@example.az' },
  ]);
  assert.deepEqual(out.valid, [
    { email: 'aysel@example.com', fullName: null, team: null },
    { email: 'b@example.com', fullName: 'Bəhruz Ə', team: 'Owls' },
    { email: 'c@example.az', fullName: null, team: null },
  ]);
  assert.deepEqual(out.duplicates, ['aysel@example.com']);
  assert.deepEqual(out.invalid.map((x) => x.reason), ['invalid_email', 'invalid_email', 'invalid_text']);
});

test('the status of an invitation, from its row', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  const row = (x) => ({ used_at: null, revoked_at: null, expires_at: '2026-11-01T00:00:00Z', opened_at: null, last_sent_at: null, sent_at: null, ...x });
  assert.equal(statusOf(row({}), now), 'not_sent');
  assert.equal(statusOf(row({ last_sent_at: '2026-10-26T10:00:00Z' }), now), 'sent');
  assert.equal(statusOf(row({ last_sent_at: '2026-10-26T10:00:00Z', opened_at: '2026-10-26T11:00:00Z' }), now), 'opened');
  assert.equal(statusOf(row({ used_at: '2026-10-26T11:30:00Z' }), now), 'registered');
  assert.equal(statusOf(row({ expires_at: '2026-10-26T11:59:00Z' }), now), 'expired');
  assert.equal(statusOf(row({ revoked_at: '2026-10-26T11:00:00Z', used_at: null }), now), 'revoked');
  assert.equal(statusOf(row({ expires_at: null }), now), 'not_sent', 'no expiry: a staff invitation of old');
});

test('the link is bound to the address and the nonce', () => {
  const inv = { id: 41, email: 'Aysel@Example.com', token_nonce: tokens.newNonce() };
  const t = tokens.sign(inv, 'mail');
  assert.equal(tokens.check(t, inv), 'mail');
  assert.equal(tokens.check(t, { ...inv, email: 'someone@example.com' }), null, 'another address');
  assert.equal(tokens.check(t, { ...inv, token_nonce: tokens.newNonce() }), null, 'invited again: the old link is dead');
  assert.equal(tokens.check(t, { ...inv, id: 42 }), null);
  const old = { id: 7, email: 'judge@example.com' };
  assert.equal(tokens.check(tokens.sign(old, 'link'), old), 'link', 'invitations without a nonce sign as before');
});
