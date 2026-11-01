/**
 * The mail provider layer, tested without any network: `fetch` and the SMTP
 * transport are replaced per test.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const MAIL_KEYS = [
  'MAIL_PROVIDER', 'RESEND_API_KEY', 'BREVO_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
  'SMTP_FROM', 'MAIL_FROM_EMAIL', 'MAIL_FROM_NAME', 'INVITE_FROM_EMAIL', 'INVITE_FROM_NAME',
  'MAIL_REPLY_TO', 'NODE_ENV',
];

const mailer = require('../src/services/mailer');
const emailService = require('../src/services/email.service');
const { renderEmail } = require('../src/services/emailTemplate');

function withEnv(vars, fn) {
  return async () => {
    const saved = Object.fromEntries(MAIL_KEYS.map((k) => [k, process.env[k]]));
    for (const k of MAIL_KEYS) delete process.env[k];
    Object.assign(process.env, vars);
    const realFetch = global.fetch;
    const realLog = console.log;
    const realErr = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      await fn();
    } finally {
      global.fetch = realFetch;
      console.log = realLog;
      console.error = realErr;
      for (const k of MAIL_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  };
}

function fakeFetch(status, body) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status < 300, status, json: async () => body };
  };
  return calls;
}

const MSG = { to: 'user@example.com', subject: 'Hi', html: '<p>x</p>', text: 'x' };

test('Resend is used when its key is set, with the configured sender', withEnv(
  { RESEND_API_KEY: 're_test', MAIL_FROM_EMAIL: 'no-reply@hack-os.app', MAIL_FROM_NAME: 'HackOS' },
  async () => {
    const calls = fakeFetch(200, { id: 'msg_1' });
    const out = await mailer.sendMail(MSG);
    assert.deepEqual(out, { ok: true, provider: 'resend', id: 'msg_1' });
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test');
    assert.equal(calls[0].body.from, 'HackOS <no-reply@hack-os.app>');
    assert.deepEqual(calls[0].body.to, ['user@example.com']);
  },
));

test('Brevo is used when only its key is set', withEnv(
  { BREVO_API_KEY: 'xkeysib', MAIL_FROM_EMAIL: 'no-reply@hack-os.app', MAIL_REPLY_TO: 'team@hack-os.app' },
  async () => {
    const calls = fakeFetch(201, { messageId: '<m@brevo>' });
    const out = await mailer.sendMail(MSG);
    assert.equal(out.ok, true);
    assert.equal(out.provider, 'brevo');
    assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(calls[0].init.headers['api-key'], 'xkeysib');
    assert.deepEqual(calls[0].body.sender, { name: 'HackOS', email: 'no-reply@hack-os.app' });
    assert.deepEqual(calls[0].body.replyTo, { email: 'team@hack-os.app' });
  },
));

test('a provider refusal comes back as a failure carrying its reason, not a throw', withEnv(
  { RESEND_API_KEY: 're_test', MAIL_FROM_EMAIL: 'no-reply@hack-os.app' },
  async () => {
    fakeFetch(403, { message: 'The hack-os.app domain is not verified' });
    const out = await mailer.sendMail(MSG);
    assert.equal(out.ok, false);
    assert.equal(out.status, 502);
    assert.match(out.message, /domain is not verified/);
  },
));

test('a network error is reported, not thrown', withEnv(
  { RESEND_API_KEY: 're_test', MAIL_FROM_EMAIL: 'no-reply@hack-os.app' },
  async () => {
    global.fetch = async () => { throw new Error('ECONNRESET'); };
    const out = await mailer.sendMail(MSG);
    assert.equal(out.ok, false);
    assert.match(out.message, /ECONNRESET/);
  },
));

test('production with no provider fails honestly instead of claiming a send', withEnv(
  { NODE_ENV: 'production' },
  async () => {
    global.fetch = async () => { throw new Error('must not be called'); };
    const out = await mailer.sendMail(MSG);
    assert.equal(out.ok, false);
    assert.equal(out.status, 503);
    assert.equal(mailer.getReadiness().configured, false);
  },
));

test('development with no provider logs the message so flows stay testable', withEnv({}, async () => {
  const out = await mailer.sendMail(MSG);
  assert.equal(out.ok, true);
  assert.equal(out.provider, 'log');
}));

test('naming a provider without its key is reported, not silently swapped', withEnv(
  { MAIL_PROVIDER: 'resend', BREVO_API_KEY: 'xkeysib', MAIL_FROM_EMAIL: 'a@hack-os.app' },
  async () => {
    assert.equal(mailer.resolveProvider(), null);
    assert.match(mailer.getReadiness().problem, /credentials are missing/);
  },
));

test('readiness never includes a secret', withEnv(
  { RESEND_API_KEY: 're_secret_value', MAIL_FROM_EMAIL: 'no-reply@hack-os.app' },
  async () => {
    const r = mailer.getReadiness();
    assert.equal(r.configured, true);
    assert.equal(r.provider, 'resend');
    assert.ok(!JSON.stringify(r).includes('re_secret_value'));
  },
));

test('header injection and junk recipients are refused before any provider call', withEnv(
  { RESEND_API_KEY: 're_test', MAIL_FROM_EMAIL: 'no-reply@hack-os.app' },
  async () => {
    global.fetch = async () => { throw new Error('must not be called'); };
    for (const to of ['', 'not-an-address', 'a@b.c\r\nBcc: x@y.z', 'a@b.c, c@d.e']) {
      const out = await mailer.sendMail({ ...MSG, to });
      assert.equal(out.ok, false, to);
      assert.equal(out.status, 400, to);
    }
  },
));

test('SMTP is the fallback when no API key is set', withEnv(
  { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u@example.com', SMTP_PASS: 'p' },
  async () => {
    assert.equal(mailer.resolveProvider(), 'smtp');
    assert.equal(mailer.resolveFrom().email, 'u@example.com');
  },
));

test('the layout escapes content and keeps only http(s) links', () => {
  const { html, text } = renderEmail({
    heading: 'Team <script>alert(1)</script>',
    paragraphs: [['Hello ', { b: '"Bobby" & co' }]],
    cta: { label: 'Go', url: 'javascript:alert(1)' },
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&quot;Bobby&quot; &amp; co'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(text.includes('Hello "Bobby" & co'));
});

test('every e-mail renders through the provider with a subject and a link', withEnv(
  { RESEND_API_KEY: 're_test', MAIL_FROM_EMAIL: 'no-reply@hack-os.app' },
  async () => {
    const calls = fakeFetch(200, { id: 'x' });
    const base = 'https://app.hack-os.app';
    const sends = [
      emailService.sendEventInviteEmail({ to: 'j@example.com', role: 'judge', eventName: 'Hack', eventCode: 'H1', frontendUrl: base }),
      emailService.sendRegistrationReceivedEmail({ to: 'h@example.com', eventName: 'Hack', status: 'pending', frontendUrl: base }),
      emailService.sendParticipantApprovedEmail({ to: 'h@example.com', eventName: 'Hack', eventCode: 'H1', frontendUrl: base }),
      emailService.sendSubmissionReceivedEmail({ to: 'h@example.com', eventName: 'Hack', teamName: 'T', projectName: 'P', frontendUrl: base }),
      emailService.sendPasswordResetEmail({ to: 'h@example.com', resetUrl: `${base}/reset-password?token=abc` }),
      emailService.sendCustomerInviteEmail({ to: 'c@example.com', inviteUrl: `${base}/invite/tok`, customerName: 'Org' }),
      emailService.sendTestEmail({ to: 'a@example.com', frontendUrl: base }),
      emailService.sendAddedToEventEmail({ to: 'j@example.com', role: 'judge', eventName: 'Hack', frontendUrl: base }),
      emailService.sendOrderPlacedEmail({ to: 'b@example.com', orderCode: 'HS-1', planName: 'Starter', billingPeriod: 'event', amountMinor: 49000, currency: 'AZN', organisation: 'Org', frontendUrl: base }),
    ];
    const outs = await Promise.all(sends);
    for (const out of outs) {
      assert.equal(out.ok, true);
      assert.equal(out.success, true);
    }
    assert.equal(calls.length, sends.length);
    for (const c of calls) {
      assert.ok(c.body.subject.length > 0);
      assert.ok(c.body.html.includes(base), c.body.subject);
      assert.ok(c.body.text.includes(base), c.body.subject);
    }
  },
));
