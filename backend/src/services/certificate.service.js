/**
 * @file certificate.service.js
 * @description Certificates: who gets which, issuing them once, revoking,
 * the public check by code, the PDF and the e-mail.
 *
 * The organiser picks the kinds in the builder (decision E10): participation
 * (members of teams that handed in a project), winners (places with a place
 * prize, else the top three), special prizes (special and track prize
 * winners), judges, mentors and volunteers. Winners and special prizes need
 * published results. Issuing is idempotent: one valid certificate per
 * person, kind and prize, each with a code that the public page confirms
 * (/verify/CODE). The name is kept as it was at issue.
 *
 * Publishing the results issues them by itself only when the certificate is
 * ready to go out: the organiser left "issue after results" on and named the
 * signer. Unpublishing revokes what publishing issued and every winner and
 * special-prize certificate (they stand on the published results); the next
 * publication issues them again. A certificate revoked by hand stays revoked.
 */

const crypto = require('crypto');
const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { CONFIG_DEFAULTS } = require('../constants/eventBuilder');
const { resolveFrontendBaseUrl } = require('../utils/frontendUrl');
const { renderCertificatePdf, dateRange } = require('./certificatePdf');
const fileService = require('./file.service');
const results = require('./results.service');
const judging = require('./judging.service');

const TYPE_TO_KIND = { participation: 'participation', winners: 'winner', special: 'special', judge: 'judge', mentor: 'mentor', volunteer: 'volunteer' };
const KIND_TO_TYPE = Object.fromEntries(Object.entries(TYPE_TO_KIND).map(([t, k]) => [k, t]));
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** XXXX-XXXX-XXXX from letters and digits that cannot be mistaken for one another. */
function newCode() {
  const bytes = crypto.randomBytes(12);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

const normaliseCode = (code) => String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})(.{4})$/, '$1-$2-$3');

const configOf = (event) => ({ ...CONFIG_DEFAULTS.certificate_config, ...(event?.certificate_config || {}) });

/** Revoked because the results were unpublished: does not stop issuing it again. */
const UNPUBLISHED = 'results_unpublished';

/**
 * Why publishing the results must not issue certificates by itself, or null
 * when it may: the organiser turned it off, chose no kinds, or has not named
 * the signer (a certificate without one goes out unsigned).
 */
function autoIssueBlocker(cfg) {
  if (cfg.issueAfterResults === false) return 'ISSUE_BY_HAND';
  if (!(cfg.types || []).length) return 'NO_KINDS';
  if (!String(cfg.signerName || '').trim()) return 'SIGNER_MISSING';
  return null;
}

async function loadEvent(eventId) {
  const r = await db.query(
    `SELECT id, name, slug, language, brand_color, city, start_date, end_date, status, archived_at,
            certificate_config, results_published_at
       FROM events WHERE id = $1`,
    [eventId],
  );
  if (!r.rows[0]) throw httpError(404, 'Event not found', 'NOT_FOUND');
  return r.rows[0];
}

/** Members of a team in this event, with their participant status. */
async function membersOf(eventId) {
  const r = await db.query(
    `SELECT t.id AS team_id, t.name AS team_name, s.project_name, u.id AS user_id, u.full_name, u.email,
            LOWER(TRIM(p.status)) AS status
       FROM teams t
       JOIN team_members tm ON tm.team_id = t.id
       JOIN users u ON u.id = tm.user_id
       JOIN participants p ON p.event_id = t.event_id AND p.user_id = u.id
       LEFT JOIN submissions s ON s.team_id = t.id AND s.event_id = t.event_id
      WHERE t.event_id = $1`,
    [eventId],
  );
  return r.rows;
}

/**
 * Who should hold which certificate, by the organiser's chosen kinds.
 * @returns {Promise<{ items: Array, needsResults: boolean }>}
 */
async function plan(eventId) {
  const event = await loadEvent(eventId);
  const cfg = configOf(event);
  const kinds = new Set((cfg.types || []).map((t) => TYPE_TO_KIND[t]).filter(Boolean));
  const items = [];
  const people = await membersOf(eventId);
  const admitted = people.filter((p) => ['approved', 'eliminated'].includes(p.status));

  if (kinds.has('participation')) {
    for (const p of admitted.filter((x) => x.project_name != null)) {
      items.push({ kind: 'participation', userId: p.user_id, name: p.full_name, email: p.email, teamId: p.team_id, teamName: p.team_name, projectName: p.project_name });
    }
  }

  let needsResults = false;
  if (kinds.has('winner') || kinds.has('special')) {
    if (!event.results_published_at) {
      needsResults = true;
    } else {
      const rows = await results.snapshot(eventId);
      const prizes = await results.winners(eventId, rows);
      const placePrizes = prizes.filter((x) => x.prize.kind === 'place' && x.prize.position);
      const prizeAt = new Map(placePrizes.map((x) => [Number(x.prize.position), x.prize.name]));
      const places = placePrizes.length ? new Set(prizeAt.keys()) : new Set([1, 2, 3]);
      if (kinds.has('winner')) {
        for (const r of rows.filter((x) => places.has(x.place))) {
          for (const p of admitted.filter((x) => Number(x.team_id) === r.teamId)) {
            items.push({
              kind: 'winner', userId: p.user_id, name: p.full_name, email: p.email, teamId: r.teamId, teamName: r.teamName, projectName: r.projectName, place: r.place, title: prizeAt.get(r.place) || null,
            });
          }
        }
      }
      if (kinds.has('special')) {
        for (const w of prizes.filter((x) => x.prize.kind !== 'place')) {
          for (const t of w.teams) {
            for (const p of admitted.filter((x) => Number(x.team_id) === t.teamId)) {
              items.push({ kind: 'special', userId: p.user_id, name: p.full_name, email: p.email, teamId: t.teamId, teamName: t.teamName, projectName: t.projectName, prizeId: w.prize.id, title: w.prize.name });
            }
          }
        }
      }
    }
  }

  const staff = async (kind, table) => {
    const r = await db.query(
      `SELECT u.id AS user_id, u.full_name, u.email FROM ${table} x JOIN users u ON u.id = x.user_id WHERE x.event_id = $1`,
      [eventId],
    );
    for (const p of r.rows) items.push({ kind, userId: p.user_id, name: p.full_name, email: p.email });
  };
  if (kinds.has('judge')) await staff('judge', 'judges');
  if (kinds.has('mentor')) await staff('mentor', 'mentor_assignments');
  if (kinds.has('volunteer')) await staff('volunteer', 'volunteers');
  return { items, needsResults, kinds: [...kinds] };
}

/**
 * The plan as the organiser's page shows it: each person and kind, and
 * whether a valid (or revoked) certificate exists for it already.
 */
async function planView(eventId) {
  const out = await plan(eventId);
  // Revoked by unpublishing: issued again with the next publication, so new.
  const have = await db.query(
    `SELECT user_id, kind, COALESCE(prize_id, 0) AS prize, revoked_at FROM certificates
      WHERE event_id = $1 AND (revoked_at IS NULL OR revoked_reason IS DISTINCT FROM $2)`,
    [eventId, UNPUBLISHED],
  );
  const key = (u, k, p) => `${u}:${k}:${p || 0}`;
  const state = new Map();
  for (const c of have.rows) {
    const k = key(c.user_id, c.kind, c.prize);
    if (!c.revoked_at) state.set(k, 'issued');
    else if (!state.has(k)) state.set(k, 'revoked');
  }
  const items = out.items.map((it) => ({
    kind: it.kind,
    userId: Number(it.userId),
    name: it.name,
    teamName: it.teamName || null,
    place: it.place || null,
    title: it.title || null,
    state: state.get(key(it.userId, it.kind, it.prizeId)) || 'new',
  }));
  const byKind = {};
  for (const it of items) {
    byKind[it.kind] = byKind[it.kind] || { total: 0, new: 0 };
    byKind[it.kind].total += 1;
    if (it.state === 'new') byKind[it.kind].new += 1;
  }
  return { kinds: out.kinds, needsResults: out.needsResults, items, byKind, toIssue: items.filter((i) => i.state === 'new').length };
}

/**
 * Issue what the plan says and does not exist yet (optionally only some
 * kinds). Certificates revoked by hand are not re-issued automatically;
 * those revoked by unpublishing the results are. `source: 'results'` marks
 * what the results publication issued, so unpublishing can take it back.
 */
async function issue(eventId, { kinds = null, source = null } = {}) {
  const event = await loadEvent(eventId);
  if (judging.isArchived(event)) throw httpError(409, 'The event is archived.', 'EVENT_ARCHIVED');
  const want = kinds && kinds.length ? new Set(kinds.map((k) => TYPE_TO_KIND[k] || k)) : null;
  const { items, needsResults } = await plan(eventId);
  let issued = 0;
  let existing = 0;
  for (const it of items) {
    if (want && !want.has(it.kind)) continue;
    // eslint-disable-next-line no-await-in-loop
    const r = await db.query(
      // Every parameter is cast: each is used twice, and Postgres must not
      // deduce two different types for one.
      `INSERT INTO certificates (event_id, user_id, type, kind, code, team_id, place, prize_id, title, recipient_name, issued_at, issued_by)
       SELECT $1::int, $2::int, $3::text, $4::text, $5::text, $6::int, $7::int, $8::int, $9::text, $10::text, now(), $11::text
        WHERE NOT EXISTS (SELECT 1 FROM certificates WHERE event_id = $1::int AND user_id = $2::int AND kind = $4::text
                            AND COALESCE(prize_id, 0) = COALESCE($8::int, 0)
                            AND (revoked_at IS NULL OR revoked_reason IS DISTINCT FROM $12::text))
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [eventId, it.userId, KIND_TO_TYPE[it.kind], it.kind, newCode(), it.teamId || null, it.place || null, it.prizeId || null,
        it.title ? String(it.title).slice(0, 200) : null, String(it.name || '').slice(0, 200), source === 'results' ? 'results' : null, UNPUBLISHED],
    );
    if (r.rows[0]) {
      issued += 1;
      // eslint-disable-next-line no-await-in-loop, global-require
      await require('./notification.service').notify([it.userId], {
        eventId: Number(eventId),
        kind: 'certificate.issued',
        target: 'certificates',
        title: it.title || null,
        data: { certificateId: r.rows[0].id, certificateKind: it.kind },
        dedupeKey: `cert:${r.rows[0].id}`,
      });
    } else existing += 1;
  }
  return { issued, existing, needsResults };
}

async function list(eventId) {
  const r = await db.query(
    `SELECT c.id, c.code, c.kind, c.place, c.title, c.recipient_name, c.issued_at, c.emailed_at, c.revoked_at,
            c.revoked_reason, c.user_id, u.email, t.name AS team_name
       FROM certificates c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN teams t ON t.id = c.team_id
      WHERE c.event_id = $1
      ORDER BY c.revoked_at NULLS FIRST, CASE c.kind WHEN 'winner' THEN 0 WHEN 'special' THEN 1 WHEN 'participation' THEN 2 ELSE 3 END,
               c.place NULLS LAST, c.recipient_name`,
    [eventId],
  );
  return r.rows;
}

async function setRevoked(eventId, id, revoked) {
  const r = await db.query(
    `UPDATE certificates SET revoked_at = ${revoked ? 'now()' : 'NULL'}, revoked_reason = NULL
      WHERE id = $1 AND event_id = $2 RETURNING id, revoked_at`,
    [id, eventId],
  ).catch((err) => {
    // Restoring a certificate that was issued again meanwhile.
    if (err.code === '23505') throw httpError(409, 'A valid certificate of this kind exists already.', 'CERTIFICATE_EXISTS');
    throw err;
  });
  if (!r.rows[0]) throw httpError(404, 'Certificate not found', 'NOT_FOUND');
  return r.rows[0];
}

/**
 * Unpublishing the results: revoke every valid certificate the publication
 * issued, and every winner and special-prize certificate, which stand on the
 * published ranking whoever issued them. Returns how many were revoked.
 */
async function revokeForUnpublish(eventId, exec = db) {
  const r = await exec.query(
    `UPDATE certificates SET revoked_at = now(), revoked_reason = $2
      WHERE event_id = $1 AND revoked_at IS NULL AND (issued_by = 'results' OR kind IN ('winner', 'special'))
      RETURNING id`,
    [eventId, UNPUBLISHED],
  );
  return r.rows.length;
}

/** One certificate with what its PDF and public page need. */
async function byCode(code) {
  const c = normaliseCode(code);
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c)) return null;
  const r = await db.query(
    `SELECT c.*, e.name AS event_name, e.slug, e.language, e.brand_color, e.city, e.start_date, e.end_date, e.timezone,
            e.certificate_config, e.is_published, t.name AS team_name, s.project_name
       FROM certificates c
       JOIN events e ON e.id = c.event_id
       LEFT JOIN teams t ON t.id = c.team_id
       LEFT JOIN submissions s ON s.team_id = c.team_id AND s.event_id = c.event_id
      WHERE c.code = $1`,
    [c],
  );
  return r.rows[0] || null;
}

const verifyUrl = (code) => `${resolveFrontendBaseUrl().replace(/\/+$/, '')}/verify/${code}`;

/** What the public verification page shows (no e-mail, no ids). */
function publicView(row) {
  return {
    code: row.code,
    kind: row.kind,
    name: row.recipient_name,
    team: row.team_name || null,
    project: row.project_name || null,
    place: row.place,
    title: row.title,
    issuedAt: row.issued_at,
    revoked: Boolean(row.revoked_at),
    event: {
      name: row.event_name,
      slug: row.is_published ? row.slug : null,
      city: row.city || null,
      startDate: row.start_date,
      endDate: row.end_date,
      timezone: row.timezone || null,
    },
  };
}

async function pdfFor(row) {
  const lang = ['az', 'en', 'ru'].includes(row.language) ? row.language : 'az';
  const cfg = configOf(row);
  let signature = null;
  if (cfg.signatureFileId) {
    const meta = await fileService.getMeta(cfg.signatureFileId);
    if (meta && Number(meta.event_id) === Number(row.event_id)) {
      const bytes = await fileService.readBytes(meta.id);
      if (bytes) signature = { bytes, mime: meta.mime };
    }
  }
  const when = dateRange(lang, row.start_date, row.end_date, row.timezone);
  return renderCertificatePdf({
    kind: row.kind,
    lang,
    name: row.recipient_name,
    event: row.event_name,
    team: row.team_name || null,
    project: row.project_name || null,
    place: row.place,
    prize: row.title,
    code: row.code,
    verifyUrl: verifyUrl(row.code),
    colour: row.brand_color,
    issuedAt: row.issued_at,
    timeZone: row.timezone,
    place_line: [row.city, when].filter(Boolean).join(' · '),
    signer: { name: cfg.signerName, title: cfg.signerTitle },
    signature,
  });
}

/** The signed-in person's own certificates, across events. */
async function mine(userId) {
  const r = await db.query(
    `SELECT c.code, c.kind, c.place, c.title, c.issued_at, e.id AS event_id, e.name AS event_name, t.name AS team_name
       FROM certificates c JOIN events e ON e.id = c.event_id LEFT JOIN teams t ON t.id = c.team_id
      WHERE c.user_id = $1 AND c.revoked_at IS NULL
      ORDER BY c.issued_at DESC`,
    [userId],
  );
  return r.rows;
}

/** Queue the e-mails: the given certificates, or every valid one not sent yet. */
async function queueEmails(eventId, ids, jobs) {
  const r = ids && ids.length
    ? await db.query('SELECT id FROM certificates WHERE event_id = $1 AND id = ANY($2::int[]) AND revoked_at IS NULL', [eventId, ids.map(Number)])
    : await db.query('SELECT id FROM certificates WHERE event_id = $1 AND revoked_at IS NULL AND emailed_at IS NULL', [eventId]);
  for (const row of r.rows) {
    // eslint-disable-next-line no-await-in-loop
    await jobs.enqueue('certificate.email', { certificateId: row.id }, { dedupeKey: `cert-mail:${row.id}:${ids && ids.length ? Date.now() : 'first'}` });
  }
  return { queued: r.rows.length };
}

module.exports = {
  TYPE_TO_KIND, newCode, normaliseCode, configOf, autoIssueBlocker, plan, planView, issue, list, setRevoked, revokeForUnpublish, byCode, publicView, pdfFor, mine, queueEmails, verifyUrl,
};
