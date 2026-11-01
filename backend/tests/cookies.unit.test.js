/**
 * Session cookies with COOKIE_DOMAIN: a browser that signed in before the
 * domain was set still holds the host-only access_token and sends it first,
 * so every sign-in (and the owner's second step) also expires that shape.
 * Without COOKIE_DOMAIN there is one shape and nothing extra is sent.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookies = require('../src/utils/cookies');

async function setCookieHeaders(handler) {
  const app = express();
  app.get('/', (req, res) => { handler(res); res.end(); });
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`);
    return res.headers.getSetCookie();
  } finally {
    server.close();
  }
}

function withDomain(domain, fn) {
  return async () => {
    const before = process.env.COOKIE_DOMAIN;
    if (domain == null) delete process.env.COOKIE_DOMAIN;
    else process.env.COOKIE_DOMAIN = domain;
    try { await fn(); } finally {
      if (before == null) delete process.env.COOKIE_DOMAIN;
      else process.env.COOKIE_DOMAIN = before;
    }
  };
}

const expired = (h) => /Expires=Thu, 01 Jan 1970/.test(h);
const named = (headers, name) => headers.filter((h) => h.startsWith(`${name}=`));

test('a sign-in with COOKIE_DOMAIN expires the host-only session cookie and sets the domain one', withDomain('.hack-os.app', async () => {
  const headers = named(await setCookieHeaders((res) => cookies.setSessionCookie(res, 'new-token')), 'access_token');
  assert.equal(headers.length, 2);
  const hostOnly = headers.find((h) => !/Domain=/i.test(h));
  const domain = headers.find((h) => /Domain=\.hack-os\.app/i.test(h));
  assert.ok(hostOnly && expired(hostOnly), 'the host-only shape is expired');
  assert.ok(hostOnly.startsWith('access_token=;'));
  assert.ok(domain && domain.startsWith('access_token=new-token;') && !expired(domain), 'the domain cookie carries the token');
  assert.match(domain, /Max-Age=\d+/);
  assert.match(domain, /HttpOnly/);
}));

test('without COOKIE_DOMAIN a sign-in sets one host-only cookie and expires nothing', withDomain(null, async () => {
  const headers = named(await setCookieHeaders((res) => cookies.setSessionCookie(res, 'new-token')), 'access_token');
  assert.equal(headers.length, 1);
  assert.ok(headers[0].startsWith('access_token=new-token;'));
  assert.doesNotMatch(headers[0], /Domain=/i);
  assert.ok(!expired(headers[0]));
}));

test("the owner's second step does the same for hh_elev", withDomain('.hack-os.app', async () => {
  const headers = named(await setCookieHeaders((res) => cookies.setElevationCookie(res, 'elev-token')), 'hh_elev');
  assert.equal(headers.length, 2);
  assert.ok(headers.some((h) => !/Domain=/i.test(h) && expired(h)));
  assert.ok(headers.some((h) => /Domain=\.hack-os\.app/i.test(h) && h.startsWith('hh_elev=elev-token;')));
}));

test('signing out still clears both shapes', withDomain('.hack-os.app', async () => {
  const headers = named(await setCookieHeaders((res) => cookies.clearSessionCookie(res)), 'access_token');
  assert.equal(headers.length, 2);
  assert.ok(headers.every(expired));
  assert.equal(headers.filter((h) => /Domain=\.hack-os\.app/i.test(h)).length, 1);
}));
