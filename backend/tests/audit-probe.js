/**
 * Read-only API sweep against a database loaded with real data.
 *
 * Logs in as one account per role and records the status of every endpoint the
 * UI calls, so breakage shows up as data rather than as a hunch. Writes are
 * limited to a handful of clearly-labelled probes and only run with --writes.
 *
 *   node tests/audit-probe.js            # reads only
 *   node tests/audit-probe.js --writes   # also exercise create/update paths
 *
 * API_URL defaults to http://localhost:5001 (the audit instance), EVENT_ID to
 * the event with the most data.
 */

const { Session } = require('./helpers');

const EVENT = process.env.EVENT_ID || '34';
const EMPTY_EVENT = process.env.EMPTY_EVENT_ID || '41';
const PASSWORD = process.env.AUDIT_PASSWORD || 'AuditPass123';
const DO_WRITES = process.argv.includes('--writes');

const ACCOUNTS = require('/tmp/audit-users.json');

const results = [];

function record(role, method, path, res, note = '') {
  const body = res.json;
  const ok = res.status >= 200 && res.status < 300;
  let shape = '';
  if (body && typeof body === 'object') {
    if (Array.isArray(body.data)) shape = `array(${body.data.length})`;
    else if (body.data === null) shape = 'null';
    else if (body.data && typeof body.data === 'object') shape = 'object';
    else if (body.success === false) shape = body.code || 'error';
  } else {
    shape = 'non-json';
  }
  results.push({ role, method, path, status: res.status, ok, shape, message: body?.message || '', note });
}

async function sweep(role, s, paths) {
  for (const [method, path, note] of paths) {
    let res;
    try {
      res = await s.request(method, path);
    } catch (e) {
      res = { status: 0, json: { success: false, message: e.message } };
    }
    record(role, method, path, res, note);
  }
}

(async () => {
  const sessions = {};
  for (const [role, email] of Object.entries(ACCOUNTS)) {
    const s = new Session(role);
    try {
      await s.login(email, PASSWORD);
      sessions[role] = s;
    } catch (e) {
      results.push({ role, method: 'POST', path: '/api/auth/login', status: 0, ok: false, shape: 'login-failed', message: e.message });
    }
  }

  const anon = new Session('anon');
  await sweep('anon', anon, [
    ['GET', '/api/health'],
    ['GET', '/api/events'],
    [`GET`, `/api/events/${EVENT}`],
    ['GET', '/api/auth/me'],
    ['GET', '/api/teams'],
    ['GET', `/api/events/${EVENT}/participants`],
  ]);

  const adminPaths = [
    ['GET', '/api/auth/me'],
    ['GET', '/api/events'],
    ['GET', '/api/events/active'],
    ['GET', `/api/events/details/${EVENT}`],
    ['GET', `/api/events/${EVENT}/analytics`],
    ['GET', '/api/users?page=1&limit=5'],
    ['GET', `/api/events/${EVENT}/participants`],
    ['GET', `/api/events/${EVENT}/participants?status=approved`],
    ['GET', `/api/teams?eventId=${EVENT}`],
    ['GET', `/api/teams?eventId=${EVENT}&excludeEmpty=true`],
    ['GET', `/api/submissions?eventId=${EVENT}`],
    ['GET', `/api/tickets?eventId=${EVENT}`],
    ['GET', `/api/announcements?eventId=${EVENT}`],
    ['GET', `/api/events/${EVENT}/judging/judges`],
    ['GET', `/api/events/${EVENT}/judging/criteria`],
    ['GET', `/api/events/${EVENT}/judging/scores`],
    ['GET', `/api/events/${EVENT}/judging/leaderboard`],
    ['GET', `/api/events/${EVENT}/mentors`],
    ['GET', `/api/events/${EVENT}/volunteers`],
    ['GET', `/api/events/${EVENT}/tracks`],
    ['GET', `/api/events/${EVENT}/prizes`],
    ['GET', `/api/events/${EVENT}/sponsors`],
    ['GET', `/api/events/${EVENT}/resources`],
    ['GET', `/api/events/${EVENT}/settings`],
    ['GET', `/api/events/${EVENT}/feedback`],
    ['GET', `/api/events/${EVENT}/invites`],
    ['GET', `/api/events/${EVENT}/certificates`],
    ['GET', `/api/events/${EVENT}/presentations`],
    ['GET', '/api/mail/status'],
    ['GET', '/api/telegram/status'],
    // the event with no participants — empty-state behaviour
    ['GET', `/api/events/${EMPTY_EVENT}/participants`, 'empty event'],
    ['GET', `/api/teams?eventId=${EMPTY_EVENT}`, 'empty event'],
    ['GET', `/api/events/${EMPTY_EVENT}/judging/leaderboard`, 'empty event'],
  ];
  if (sessions.admin) await sweep('admin', sessions.admin, adminPaths);

  if (sessions.judge) await sweep('judge', sessions.judge, [
    ['GET', '/api/auth/me'],
    ['GET', '/api/judge/me/events'],
    ['GET', `/api/submissions?eventId=${EVENT}`],
    ['GET', `/api/events/${EVENT}/judging/criteria`],
    ['GET', `/api/events/${EVENT}/judging/scores`],
    ['GET', `/api/events/${EVENT}/judging/leaderboard`],
    ['GET', `/api/announcements?eventId=${EVENT}`],
    ['GET', `/api/events/${EVENT}/participants`],
    ['GET', `/api/teams?eventId=${EVENT}`],
    ['GET', '/api/users?page=1&limit=5', 'should be forbidden'],
  ]);

  if (sessions.mentor) await sweep('mentor', sessions.mentor, [
    ['GET', '/api/auth/me'],
    ['GET', '/api/mentor/me/events'],
    ['GET', `/api/tickets?eventId=${EVENT}`],
    ['GET', `/api/teams?eventId=${EVENT}`],
    ['GET', `/api/submissions?eventId=${EVENT}`],
    ['GET', `/api/announcements?eventId=${EVENT}`],
    ['GET', `/api/events/${EVENT}/resources`],
    ['GET', `/api/events/${EVENT}/participants`],
  ]);

  for (const role of ['hacker-lead', 'hacker-member']) {
    if (!sessions[role]) continue;
    await sweep(role, sessions[role], [
      ['GET', '/api/auth/me'],
      ['GET', '/api/events/active'],
      ['GET', `/api/teams/mine?eventId=${EVENT}`],
      ['GET', '/api/teams/mine', 'no eventId — falls back to active event'],
      ['GET', `/api/submissions?eventId=${EVENT}`],
      ['GET', '/api/submissions'],
      ['GET', `/api/tickets?eventId=${EVENT}`],
      ['GET', `/api/announcements?eventId=${EVENT}`],
      ['GET', `/api/events/${EVENT}/resources`],
      ['GET', `/api/events/${EVENT}/participants/lobby-hackers`],
      ['GET', `/api/events/${EVENT}/participants/lobby-self-approval`],
      ['GET', `/api/team-invites/incoming?eventId=${EVENT}`],
      ['GET', `/api/team-invites/outgoing?eventId=${EVENT}`],
      ['GET', `/api/events/${EVENT}/judging/leaderboard`],
      ['GET', `/api/events/${EVENT}/feedback/mine`],
      ['GET', `/api/events/${EVENT}/participants`, 'should be forbidden'],
    ]);
  }

  if (sessions.volunteer) await sweep('volunteer', sessions.volunteer, [
    ['GET', '/api/auth/me'],
    ['GET', `/api/events/${EVENT}/volunteers`],
    ['GET', `/api/teams?eventId=${EVENT}`],
    ['GET', `/api/events/${EVENT}/participants`],
    ['GET', `/api/announcements?eventId=${EVENT}`],
  ]);

  if (DO_WRITES && sessions.admin) {
    const a = sessions.admin;
    const probes = [
      ['POST', `/api/announcements`, { eventId: Number(EVENT), title: 'AUDIT probe', content: 'audit', type: 'info' }],
      ['POST', `/api/events/${EVENT}/tracks`, { name: 'AUDIT track', description: 'audit', color: '#888888' }],
      ['POST', `/api/events/${EVENT}/prizes`, { name: 'AUDIT prize', description: 'audit', value: '0', position: 99 }],
      ['POST', `/api/events/${EVENT}/resources`, { section: 'AUDIT', label: 'audit', url: 'https://example.com' }],
      ['PUT', `/api/events/${EVENT}/settings`, { auditProbe: 'yes' }],
    ];
    for (const [method, path, body] of probes) {
      let res;
      try { res = await a.request(method, path, body); }
      catch (e) { res = { status: 0, json: { message: e.message } }; }
      record('admin(write)', method, path, res, 'probe');
    }
  }

  // ── report ──────────────────────────────────────────────────────────────
  const bad = results.filter((r) => !r.ok);
  const byRole = {};
  for (const r of results) (byRole[r.role] ||= []).push(r);

  console.log('\n================ API SWEEP ================\n');
  for (const [role, rows] of Object.entries(byRole)) {
    const fails = rows.filter((r) => !r.ok).length;
    console.log(`${role}  (${rows.length - fails}/${rows.length} ok)`);
    for (const r of rows) {
      const flag = r.ok ? '  ' : '!!';
      const note = r.note ? `  ← ${r.note}` : '';
      console.log(`  ${flag} ${String(r.status).padEnd(4)} ${r.method.padEnd(5)} ${r.path.padEnd(56)} ${r.shape}${note}`);
      if (!r.ok && r.message) console.log(`        ${r.message.slice(0, 100)}`);
    }
    console.log('');
  }
  console.log(`TOPLAM: ${results.length}, uğursuz: ${bad.length}`);
  require('fs').writeFileSync('/tmp/audit-results.json', JSON.stringify(results, null, 1));
})().catch((e) => { console.error('SWEEP FAILED:', e); process.exit(1); });
