/**
 * Where an outgoing webhook may be sent (src/services/webhookUrl.js): the
 * production rules, with the switch for local work off. No API needed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  addressProblem, parseTargetUrl, resolveTarget, safeLookup, allowPrivateTargets,
} = require('../src/services/webhookUrl');

const strict = { allowPrivate: false };
const local = { allowPrivate: true };

test('production refuses every private, loopback and metadata address, however it is written', () => {
  const refused = [
    '127.0.0.1', '127.1.2.3', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1',
    '169.254.169.254', '169.254.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '0000:0000:0000:0000:0000:ffff:a9fe:a9fe',
    '::ffff:169.254.169.254', '::ffff:10.0.0.1', '64:ff9b::a9fe:a9fe', '64:ff9b::10.1.1.1', '::127.0.0.1',
    '2002:7f00:1::', '2001:db8::1', '[::1]', 'fe80::1%eth0', '::ffff:0:7f00:1', '::ffff:0:10.0.0.1', '64:ff9b:1::a00:1',
  ];
  for (const a of refused) assert.ok(addressProblem(a, strict), `${a} must be refused`);
  for (const a of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '::ffff:1.1.1.1']) {
    assert.equal(addressProblem(a, strict), null, `${a} is public`);
  }
});

test('the switch for local work allows loopback and private networks, never metadata or multicast', () => {
  for (const a of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '::1', 'fc00::1', '::ffff:127.0.0.1']) {
    assert.equal(addressProblem(a, local), null, `${a} is allowed locally`);
  }
  for (const a of ['169.254.169.254', '::ffff:169.254.169.254', '0.0.0.0', '::', 'fe80::1', '224.0.0.1', 'ff02::1']) {
    assert.ok(addressProblem(a, local), `${a} stays refused`);
  }
});

test('the switch defaults to on for development and tests only', () => {
  const saved = { node: process.env.NODE_ENV, sw: process.env.WEBHOOKS_ALLOW_PRIVATE_TARGETS };
  try {
    delete process.env.WEBHOOKS_ALLOW_PRIVATE_TARGETS;
    process.env.NODE_ENV = 'production';
    assert.equal(allowPrivateTargets(), false);
    delete process.env.NODE_ENV;
    assert.equal(allowPrivateTargets(), false, 'a server started without NODE_ENV is production');
    process.env.NODE_ENV = 'staging';
    assert.equal(allowPrivateTargets(), false);
    process.env.NODE_ENV = 'test';
    assert.equal(allowPrivateTargets(), true);
    process.env.NODE_ENV = 'development';
    assert.equal(allowPrivateTargets(), true);
    process.env.WEBHOOKS_ALLOW_PRIVATE_TARGETS = 'false';
    assert.equal(allowPrivateTargets(), false);
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOKS_ALLOW_PRIVATE_TARGETS = 'true';
    assert.equal(allowPrivateTargets(), true);
  } finally {
    if (saved.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.node;
    if (saved.sw === undefined) delete process.env.WEBHOOKS_ALLOW_PRIVATE_TARGETS;
    else process.env.WEBHOOKS_ALLOW_PRIVATE_TARGETS = saved.sw;
  }
});

test('the URL: https only, no credentials, no local names, no private literals', () => {
  const bad = {
    'http://example.com/hook': 'https://',
    'ftp://example.com/': 'https://',
    'https://user:pass@example.com/': 'credentials',
    'https://localhost/hook': 'local host name',
    'https://printer.local/': 'local host name',
    'https://db.internal/': 'local host name',
    'https://127.0.0.1/': 'private or loopback',
    'https://[::1]/': 'private or loopback',
    'https://[::ffff:7f00:1]/': 'private or loopback',
    'https://169.254.169.254/latest/meta-data/': 'link-local',
    'https://0.0.0.0/': 'link-local, multicast or unspecified',
    'not a url': 'not a valid URL',
    '': 'Enter the URL',
  };
  for (const [url, words] of Object.entries(bad)) {
    const out = parseTargetUrl(url, strict);
    assert.ok(out.error, `${url} must be refused`);
    assert.match(out.error, new RegExp(words.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')), url);
  }
  assert.match(parseTargetUrl(`https://example.com/${'a'.repeat(2100)}`, strict).error, /longer than/);
  const ok = parseTargetUrl('https://hooks.example.com/in/abc?x=1#frag', strict);
  assert.equal(ok.error, undefined);
  assert.equal(ok.url.toString(), 'https://hooks.example.com/in/abc?x=1', 'the fragment is dropped');
  assert.equal(parseTargetUrl('http://127.0.0.1:5190/hook', local).error, undefined, 'allowed for local work');
  // Each refusal names its reason, which the app shows in the reader's language.
  const reasons = {
    '': 'required', 'nope': 'invalid', 'http://example.com/': 'not_https', 'https://a:b@example.com/': 'credentials',
    'https://localhost/': 'local_name', 'https://10.1.2.3/': 'private_address', 'https://169.254.169.254/': 'blocked_address',
  };
  for (const [url, reason] of Object.entries(reasons)) assert.equal(parseTargetUrl(url, strict).reason, reason, url);
});

test('a host is refused when any address it resolves to is private', async () => {
  const lookup = (answers) => async () => answers;
  await assert.rejects(
    resolveTarget('hooks.example.com', { ...strict, lookup: lookup([{ address: '10.0.0.5', family: 4 }]) }),
    /points to a private or loopback address/,
  );
  await assert.rejects(
    resolveTarget('hooks.example.com', {
      ...strict, lookup: lookup([{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }]),
    }),
    /link-local/,
    'one bad address among good ones is enough',
  );
  await assert.rejects(
    resolveTarget('nowhere.example', { ...strict, lookup: async () => { throw new Error('ENOTFOUND'); } }),
    (err) => /could not be found/.test(err.message) && err.reason === 'not_found',
  );
  const list = await resolveTarget('hooks.example.com', { ...strict, lookup: lookup([{ address: '93.184.216.34', family: 4 }]) });
  assert.deepEqual(list, [{ address: '93.184.216.34', family: 4 }]);
  await assert.rejects(resolveTarget('localhost', strict), /private or loopback/);
});

function request(port, lookup) {
  return new Promise((resolve) => {
    const req = http.request({ host: 'rebind.test', port, path: '/', method: 'POST', lookup, agent: false }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', (err) => resolve({ error: err }));
    req.end('{}');
  });
}

test('the connection goes to the address that was checked, so a host that changes its answer (DNS rebinding) is refused', async () => {
  const server = http.createServer((req, res) => { req.resume(); res.end('ok'); });
  await new Promise((done) => { server.listen(0, '127.0.0.1', done); });
  const { port } = server.address();
  try {
    // Allowed for local work: the request reaches the address the lookup answered.
    let r = await request(port, safeLookup({ ...local, lookup: async () => [{ address: '127.0.0.1', family: 4 }] }));
    assert.equal(r.status, 200, r.error && r.error.message);

    // Public when the endpoint was saved, loopback when the delivery connects.
    let calls = 0;
    const rebinding = async () => {
      calls += 1;
      return [{ address: calls === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }];
    };
    await resolveTarget('rebind.test', { ...strict, lookup: rebinding });
    r = await request(port, safeLookup({ ...strict, lookup: rebinding }));
    assert.ok(r.error, 'refused at connect time');
    assert.equal(r.error.code, 'WEBHOOK_TARGET_REFUSED');
    assert.match(r.error.message, /private or loopback/);
  } finally {
    server.close();
  }
});
