/**
 * The link in the staff invite e-mail, tested without SMTP.
 *
 * It used to point at /register, a route the web app does not have; the
 * middleware bounced it to /login and dropped the query string, so invitees
 * landed on an empty sign-in form.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildInviteRegisterUrl } = require('../src/services/email.service');

test('the invite links to the login screen, where registration actually lives', () => {
  const url = new URL(buildInviteRegisterUrl('https://app.hack-os.app', 'HBTN2026', 'Judge.One@Example.com'));
  assert.equal(url.pathname, '/login');
  assert.equal(url.searchParams.get('eventCode'), 'HBTN2026');
  assert.equal(url.searchParams.get('email'), 'Judge.One@Example.com');
  assert.equal(url.searchParams.get('register'), '1');
});

test('a trailing slash on FRONTEND_URL does not produce a double slash', () => {
  assert.equal(
    buildInviteRegisterUrl('https://app.hack-os.app/', 'X', 'a@b.c'),
    'https://app.hack-os.app/login?eventCode=X&email=a%40b.c&register=1',
  );
});

test('characters that would break the query string are escaped', () => {
  const url = new URL(buildInviteRegisterUrl('http://localhost:3000', 'A&B', 'x+y@example.com'));
  assert.equal(url.searchParams.get('eventCode'), 'A&B');
  assert.equal(url.searchParams.get('email'), 'x+y@example.com');
});

test('links in e-mails use the browser host only when it is one of the app hosts', () => {
  const saved = { a: process.env.FRONTEND_URL, b: process.env.FRONTEND_URLS };
  process.env.FRONTEND_URL = 'https://hack-os.app';
  process.env.FRONTEND_URLS = 'https://www.hack-os.app, https://app.hack-os.app';
  try {
    const { pickFrontendBase } = require('../src/utils/frontendUrl');
    assert.equal(pickFrontendBase('https://app.hack-os.app/login?eventId=3'), 'https://app.hack-os.app');
    assert.equal(pickFrontendBase('https://evil.example/login'), 'https://hack-os.app');
    assert.equal(pickFrontendBase('https://app.hack-os.app.evil.example/'), 'https://hack-os.app');
    assert.equal(pickFrontendBase('javascript:alert(1)'), 'https://hack-os.app');
    assert.equal(pickFrontendBase(undefined), 'https://hack-os.app');
  } finally {
    for (const [k, v] of [['FRONTEND_URL', saved.a], ['FRONTEND_URLS', saved.b]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
