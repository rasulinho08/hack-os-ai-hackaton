/**
 * AES-256-GCM sealing of stored secrets (no database).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const box = require('../src/utils/secretBox');

const KEY_A = crypto.randomBytes(32).toString('base64');
const KEY_B = crypto.randomBytes(32).toString('hex');

function withKeys(current, previous, fn) {
  const saved = [process.env.DATA_ENCRYPTION_KEY, process.env.DATA_ENCRYPTION_KEY_PREVIOUS];
  if (current == null) delete process.env.DATA_ENCRYPTION_KEY; else process.env.DATA_ENCRYPTION_KEY = current;
  if (previous == null) delete process.env.DATA_ENCRYPTION_KEY_PREVIOUS; else process.env.DATA_ENCRYPTION_KEY_PREVIOUS = previous;
  try { return fn(); } finally {
    if (saved[0] == null) delete process.env.DATA_ENCRYPTION_KEY; else process.env.DATA_ENCRYPTION_KEY = saved[0];
    if (saved[1] == null) delete process.env.DATA_ENCRYPTION_KEY_PREVIOUS; else process.env.DATA_ENCRYPTION_KEY_PREVIOUS = saved[1];
  }
}

const ROOM = 'https://zoom.us/j/123456789?pwd=s3cr3t';

test('without a key nothing is sealed and plain values pass through', () => withKeys(null, null, () => {
  assert.equal(box.isEnabled(), false);
  assert.equal(box.seal(ROOM), ROOM);
  assert.equal(box.open(ROOM), ROOM);
  assert.equal(box.seal(null), null);
  assert.equal(box.seal(''), '');
}));

test('with a key: sealed, never twice the same, opened back', () => withKeys(KEY_A, null, () => {
  const a = box.seal(ROOM);
  const b = box.seal(ROOM);
  assert.match(a, /^enc:v1:[0-9a-f]{8}:/);
  assert.notEqual(a, b, 'a fresh IV each time');
  assert.ok(!a.includes('s3cr3t'));
  assert.equal(box.open(a), ROOM);
  assert.equal(box.seal(a), a, 'sealing a sealed value changes nothing');
  assert.equal(box.open('https://plain.example'), 'https://plain.example', 'older plain values still read');
}));

test('a changed value or a missing key opens as null, never as ciphertext', () => withKeys(KEY_A, null, () => {
  const sealed = box.seal(ROOM);
  const parts = sealed.split(':');
  const ct = Buffer.from(parts.at(-1), 'base64url');
  ct[0] ^= 1;
  parts[parts.length - 1] = ct.toString('base64url');
  assert.equal(box.open(parts.join(':')), null, 'integrity check');
  withKeys(KEY_B, null, () => assert.equal(box.open(sealed), null, 'another key'));
}));

test('rotation: the previous key still opens what it sealed', () => {
  const old = withKeys(KEY_A, null, () => box.seal(ROOM));
  withKeys(KEY_B, KEY_A, () => {
    assert.equal(box.open(old), ROOM);
    const fresh = box.seal(ROOM);
    assert.notEqual(fresh.split(':')[2], old.split(':')[2], 'new values use the new key');
    assert.equal(box.open(fresh), ROOM);
  });
});

test('a key must be 32 bytes', () => {
  assert.throws(() => box.parseKey('short'), /32 bytes/);
  assert.equal(box.parseKey(KEY_A).length, 32);
  assert.equal(box.parseKey(KEY_B).length, 32);
});

test('openEvent opens the room link of a row, leaves the rest', () => withKeys(KEY_A, null, () => {
  const row = { id: 1, name: 'X', online_url: box.seal(ROOM) };
  const opened = box.openEvent(row);
  assert.equal(opened.online_url, ROOM);
  assert.notEqual(opened, row, 'a copy');
  assert.ok(row.online_url.startsWith('enc:v1:'), 'the row itself is untouched');
  const plain = { id: 2, online_url: 'https://a.example' };
  assert.equal(box.openEvent(plain), plain);
}));
