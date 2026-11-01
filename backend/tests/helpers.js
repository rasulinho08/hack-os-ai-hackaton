/**
 * Tiny HTTP client for end-to-end tests against a running API.
 * Keeps an in-memory cookie jar per "session" so each test user behaves
 * like a separate browser.
 */

const API_URL = (process.env.API_URL || 'http://localhost:5000').replace(/\/+$/, '');
const PASSWORD = 'Test1234!';

class Session {
  constructor(label = 'anon') {
    this.label = label;
    this.cookies = new Map();
    this.user = null;
  }

  _storeCookies(res) {
    const raw = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
    for (const line of raw) {
      const [pair, ...attrs] = line.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a) || /expires=Thu, 01 Jan 1970/i.test(a));
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(method, path, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookies.size) {
      headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    this._storeCookies(res);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, json, text, data: json?.data };
  }

  /** Send raw bytes (a file upload); the body is the file itself. */
  async upload(path, data, { type = 'application/octet-stream', name = 'file' } = {}) {
    const headers = { 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers, body: data, redirect: 'manual' });
    this._storeCookies(res);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, json, text, data: json?.data };
  }

  /** GET raw bytes (a file download). */
  async download(path) {
    const headers = {};
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${API_URL}${path}`, { headers, redirect: 'manual' });
    return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
  }

  get(path) { return this.request('GET', path); }
  post(path, body = {}) { return this.request('POST', path, body); }
  put(path, body = {}) { return this.request('PUT', path, body); }
  patch(path, body = {}) { return this.request('PATCH', path, body); }
  delete(path, body) { return this.request('DELETE', path, body); }

  async login(email, password = PASSWORD) {
    const r = await this.post('/api/auth/login', { email, password });
    if (r.status !== 200) {
      throw new Error(`[${this.label}] login failed for ${email}: ${r.status} ${r.text.slice(0, 200)}`);
    }
    this.user = r.data?.user || r.data;
    return r;
  }

  /**
   * Sign up, open the confirmation link from the e-mail (as the person
   * would: invitations for the address wait for it), then sign in.
   * `{ verify: false }` leaves the address unconfirmed.
   */
  async register(payload, { verify = true } = {}) {
    const r = await this.post('/api/auth/register', { password: PASSWORD, ...payload });
    if (r.status !== 201) {
      throw new Error(`[${this.label}] register failed for ${payload.email}: ${r.status} ${r.text.slice(0, 300)}`);
    }
    if (verify && r.data?.verificationRequired) await confirmEmail(payload.email, r.data.verifyUrl);
    await this.login(payload.email);
    return r.data;
  }
}

/** Unique suffix per test run so re-runs never collide on emails / event codes. */
const RUN_ID = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const email = (name) => `${name}.${RUN_ID}@e2e.test`;

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

/**
 * The mail the fake SMTP server (tests/fakeSmtp.js) received for `address`,
 * newest first, with quoted-printable undone; [] when no fake is running.
 */
async function mailsTo(address) {
  const url = process.env.FAKE_SMTP_LOG || 'http://127.0.0.1:2526/__log';
  let log = [];
  try { log = await (await fetch(url)).json(); } catch { return []; }
  const want = String(address).toLowerCase();
  return log
    .filter((m) => (m.to || []).some((t) => String(t).toLowerCase() === want))
    .map((m) => ({ ...m, text: String(m.data || '').replace(/=\r?\n/g, '').replace(/=3D/gi, '=') }))
    .reverse();
}

/**
 * The token of the newest confirmation link e-mailed to `address`, waiting
 * up to `ms` for the mail (it leaves after the response); null without one.
 */
async function verifyTokenFor(address, ms = 8000) {
  const until = Date.now() + ms;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const mail = (await mailsTo(address)).find((m) => /\/verify-email\?token=/.test(m.text));
    if (mail) return decodeURIComponent(/\/verify-email\?token=([A-Za-z0-9_%-]+)/.exec(mail.text)[1]);
    if (Date.now() > until) return null;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((done) => { setTimeout(done, 100); });
  }
}

/**
 * Opens the confirmation link for `address`: the one handed back in
 * development without a mail provider, else the one in the fake SMTP log.
 */
async function confirmEmail(address, devUrl) {
  const token = devUrl ? new URL(devUrl).searchParams.get('token') : await verifyTokenFor(address);
  if (!token) throw new Error(`no confirmation e-mail reached ${address}`);
  const r = await new Session('verify').post('/api/auth/verify-email', { token });
  if (r.status !== 200) throw new Error(`confirming ${address} failed: ${r.status} ${r.text.slice(0, 200)}`);
  return r.data;
}

module.exports = { API_URL, PASSWORD, Session, RUN_ID, email, DAY, iso, mailsTo, verifyTokenFor, confirmEmail };
