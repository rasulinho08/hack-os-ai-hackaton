/**
 * @file mailer.js
 * @description One way out for every e-mail the API sends.
 *
 * Providers, in the order they are picked when MAIL_PROVIDER is not set:
 *
 *   resend  RESEND_API_KEY        HTTPS API (api.resend.com)
 *   brevo   BREVO_API_KEY         HTTPS API (api.brevo.com)
 *   smtp    SMTP_HOST/USER/PASS   nodemailer
 *
 * The HTTPS providers come first on purpose: hosts such as Render's free plan
 * block outbound SMTP ports, and a blocked port shows up as a 20-second
 * timeout on every send rather than as an error anyone notices.
 *
 * With no provider at all, development logs the message (so password reset
 * and invites can still be followed locally) and production reports a failure
 * instead of pretending the mail went out.
 *
 * `sendMail` never throws. Callers decide what a failed send means for them;
 * for most of them it means nothing, because the mail is a courtesy and the
 * action it reports on has already happened.
 */

const nodemailer = require('nodemailer');

const REQUEST_TIMEOUT_MS = 15_000;
const PROVIDERS = ['resend', 'brevo', 'smtp'];

const env = (key) => String(process.env[key] || '').trim();
const isProduction = () => env('NODE_ENV') === 'production';

function smtpConfigured() {
  return Boolean(env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS'));
}

function providerConfigured(name) {
  if (name === 'resend') return Boolean(env('RESEND_API_KEY'));
  if (name === 'brevo') return Boolean(env('BREVO_API_KEY'));
  if (name === 'smtp') return smtpConfigured();
  return false;
}

/**
 * The provider that will carry the next message, or null when there is none.
 * An explicit MAIL_PROVIDER wins, but only when its credentials are present —
 * naming a provider without its key is a configuration mistake, not a reason
 * to silently pick a different one.
 */
function resolveProvider() {
  const explicit = env('MAIL_PROVIDER').toLowerCase();
  if (explicit) return PROVIDERS.includes(explicit) && providerConfigured(explicit) ? explicit : null;
  return PROVIDERS.find(providerConfigured) || null;
}

function resolveFrom() {
  const email =
    env('MAIL_FROM_EMAIL') ||
    env('INVITE_FROM_EMAIL') ||
    env('SMTP_FROM') ||
    env('SMTP_USER');
  const name = (env('MAIL_FROM_NAME') || env('INVITE_FROM_NAME') || 'HackOS').replace(/["<>]/g, '');
  return { email, name };
}

function isMailConfigured() {
  return Boolean(resolveProvider() && resolveFrom().email);
}

/** What /api/mail/status reports. No secrets, only whether they are present. */
function getReadiness() {
  const provider = resolveProvider();
  const from = resolveFrom();
  const explicit = env('MAIL_PROVIDER').toLowerCase();
  let problem = null;
  if (explicit && !PROVIDERS.includes(explicit)) {
    problem = `MAIL_PROVIDER="${explicit}" is not one of ${PROVIDERS.join(', ')}`;
  } else if (explicit && !provider) {
    problem = `MAIL_PROVIDER=${explicit} is set but its credentials are missing`;
  } else if (!provider) {
    problem = 'No mail provider configured: set RESEND_API_KEY, BREVO_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS';
  } else if (!from.email) {
    problem = 'No sender address: set MAIL_FROM_EMAIL';
  }
  return {
    configured: !problem,
    provider,
    fromEmail: from.email || null,
    fromName: from.name,
    replyTo: env('MAIL_REPLY_TO') || null,
    problem,
    /* Older dashboards read these two names. */
    smtpConfigured: !problem,
    fromConfigured: Boolean(from.email),
  };
}

function createSmtpTransporter() {
  if (!smtpConfigured()) return null;
  const port = parseInt(env('SMTP_PORT') || '587', 10);
  const secureFlag = env('SMTP_SECURE').toLowerCase();
  /* 465 is implicit TLS; 587 upgrades with STARTTLS. */
  const secure = secureFlag === 'true' || (secureFlag !== 'false' && port === 465);
  return nodemailer.createTransport({
    host: env('SMTP_HOST'),
    port,
    secure,
    auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
    requireTLS: port === 587 && !secure,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    tls: {
      minVersion: 'TLSv1.2',
      ...(env('SMTP_TLS_REJECT_UNAUTHORIZED') === '0' ? { rejectUnauthorized: false } : {}),
    },
  });
}

/** Read a provider's error body without letting a bad body hide the status. */
async function readError(res) {
  try {
    const body = await res.json();
    return body?.message || body?.error || body?.code || `HTTP ${res.status}`;
  } catch (_) {
    return `HTTP ${res.status}`;
  }
}

async function sendViaResend(msg, from) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${from.name} <${from.email}>`,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      ...(msg.text ? { text: msg.text } : {}),
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) return { ok: false, status: res.status, message: await readError(res) };
  const body = await res.json().catch(() => ({}));
  return { ok: true, id: body?.id || null };
}

async function sendViaBrevo(msg, from) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env('BREVO_API_KEY'),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: from.name, email: from.email },
      to: [{ email: msg.to }],
      subject: msg.subject,
      htmlContent: msg.html,
      ...(msg.text ? { textContent: msg.text } : {}),
      ...(msg.replyTo ? { replyTo: { email: msg.replyTo } } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) return { ok: false, status: res.status, message: await readError(res) };
  const body = await res.json().catch(() => ({}));
  return { ok: true, id: body?.messageId || null };
}

async function sendViaSmtp(msg, from) {
  const transporter = createSmtpTransporter();
  const info = await transporter.sendMail({
    from: `"${from.name}" <${from.email}>`,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    ...(msg.text ? { text: msg.text } : {}),
    ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
  });
  return { ok: true, id: info?.messageId || null };
}

/** ma***@example.com — enough to follow a delivery in the logs, no more. */
function maskAddress(addr) {
  const [local, domain] = String(addr).split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}

const SENDERS = { resend: sendViaResend, brevo: sendViaBrevo, smtp: sendViaSmtp };

/* Deliberately loose: the point is to refuse header injection and obvious
   garbage before spending a provider call, not to validate RFC 5322. */
const ADDRESS_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/**
 * @param {{ to: string, subject: string, html: string, text?: string, replyTo?: string, fromName?: string }} msg
 * @returns {Promise<{ ok: true, provider: string, id: string|null, logged?: true }
 *                  | { ok: false, provider: string|null, status: number, message: string }>}
 */
async function sendMail(msg) {
  const to = String(msg?.to || '').trim();
  const subject = String(msg?.subject || '').replace(/[\r\n]+/g, ' ').trim();
  if (!ADDRESS_RE.test(to)) return { ok: false, provider: null, status: 400, message: 'Invalid recipient address' };
  if (!subject || !msg?.html) return { ok: false, provider: null, status: 400, message: 'Missing subject or body' };

  const provider = resolveProvider();
  const platformFrom = resolveFrom();
  // An event may sign its own mail (builder → Communication): the name shown
  // changes, the address stays the platform's verified one.
  const fromName = String(msg.fromName || '').replace(/[\r\n"<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const from = fromName ? { ...platformFrom, name: fromName } : platformFrom;
  const wantedReplyTo = String(msg.replyTo || '').trim();
  const replyTo = (ADDRESS_RE.test(wantedReplyTo) ? wantedReplyTo : '') || env('MAIL_REPLY_TO') || undefined;

  if (!provider || !from.email) {
    if (isProduction()) {
      const { problem } = getReadiness();
      console.error(`[mail] not sent to ${maskAddress(to)} ("${subject}"): ${problem}`);
      return { ok: false, provider, status: 503, message: problem };
    }
    console.log(`[mail] (no provider, development) to=${maskAddress(to)} subject="${subject}"`);
    if (msg.text) console.log(msg.text);
    return { ok: true, provider: 'log', id: null, logged: true };
  }

  try {
    const out = await SENDERS[provider]({ to, subject, html: msg.html, text: msg.text, replyTo }, from);
    if (out.ok) {
      console.log(`[mail] sent via ${provider} to=${maskAddress(to)} subject="${subject}" id=${out.id || '-'}`);
      return { ok: true, provider, id: out.id };
    }
    console.error(`[mail] ${provider} refused to=${maskAddress(to)} subject="${subject}": ${out.message}`);
    return { ok: false, provider, status: 502, message: `${provider}: ${out.message}` };
  } catch (err) {
    const message = err?.name === 'TimeoutError' ? 'request timed out' : err?.message || 'send failed';
    console.error(`[mail] ${provider} failed to=${maskAddress(to)} subject="${subject}": ${message}`);
    return { ok: false, provider, status: 502, message: `${provider}: ${message}` };
  }
}

module.exports = {
  sendMail,
  getReadiness,
  isMailConfigured,
  resolveProvider,
  resolveFrom,
  createSmtpTransporter,
  maskAddress,
};
