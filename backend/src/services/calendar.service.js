/**
 * @file calendar.service.js
 * @description Calendar feeds (plan module 'calendar').
 *
 *   public   GET /api/public/events/:slug/calendar.ics — the dates anyone may
 *            know: the event, registration closing, the team and project
 *            deadlines, demo day, results. No online room link.
 *   personal GET /api/calendar/<token>.ics — every event the person is part
 *            of, with what concerns them: judges get the judging window,
 *            a participant their team's presentation slot, and the online
 *            room link where they are let in (as GET /api/events does).
 *
 * The personal link is signed (HMAC of the account and a version number in
 * users.calendar_token_version): nothing is stored, and resetting the link
 * raises the version so every old link stops working. Times are written in
 * UTC; calendar apps show them in the reader's own zone.
 */

const crypto = require('crypto');
const db = require('../config/db');
const { calendar } = require('../utils/ics');
const { open } = require('../utils/secretBox');
const { forEvent } = require('./entitlement.service');
const { resolveFrontendBaseUrl } = require('../utils/frontendUrl');
const { httpError } = require('../utils/responseFormat');

const UID_HOST = 'hack-os.app';
const ORG_MANAGER_ROLES = ['owner', 'admin', 'organizer'];

const WORDS = {
  en: {
    registrationCloses: 'Registration closes — {event}', teamDeadline: 'Teams close — {event}',
    submissionDeadline: 'Projects due — {event}', judging: 'Judging — {event}', demoDay: 'Demo day — {event}',
    results: 'Results — {event}', presentation: 'Your team presents — {event}', online: 'Online', join: 'Join online', page: 'Event page',
    personal: 'My HackOS events',
  },
  az: {
    registrationCloses: 'Qeydiyyat bağlanır — {event}', teamDeadline: 'Komandalar bağlanır — {event}',
    submissionDeadline: 'Layihələrin son tarixi — {event}', judging: 'Qiymətləndirmə — {event}', demoDay: 'Demo günü — {event}',
    results: 'Nəticələr — {event}', presentation: 'Komandanızın təqdimatı — {event}', online: 'Onlayn', join: 'Onlayn qoşulun', page: 'Tədbir səhifəsi',
    personal: 'HackOS tədbirlərim',
  },
  ru: {
    registrationCloses: 'Регистрация закрывается — {event}', teamDeadline: 'Команды закрываются — {event}',
    submissionDeadline: 'Сдача проектов — {event}', judging: 'Оценка проектов — {event}', demoDay: 'Демо-день — {event}',
    results: 'Итоги — {event}', presentation: 'Выступление вашей команды — {event}', online: 'Онлайн', join: 'Подключиться онлайн', page: 'Страница события',
    personal: 'Мои события HackOS',
  },
};
const wordsFor = (lang) => WORDS[lang] || WORDS.en;
const fill = (s, event) => s.split('{event}').join(event);

/* ── The personal link ──────────────────────────────────────────────────── */

function key() {
  const secret = process.env.INVITE_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return crypto.createHmac('sha256', String(secret)).update('hackos:calendar:v1').digest();
}

const macOf = (userId, version) => crypto.createHmac('sha256', key()).update(`cal:${userId}:${version}`).digest('base64url').slice(0, 32);

function tokenFor(userId, version) {
  return `${userId}.${version}.${macOf(userId, version)}`;
}

/** The account a feed token belongs to, or null (also for a link that was reset). */
async function userFromToken(token) {
  const m = /^(\d{1,12})\.(\d{1,9})\.([A-Za-z0-9_-]{32})$/.exec(String(token || ''));
  if (!m) return null;
  const [, id, version, mac] = m;
  const expected = Buffer.from(macOf(id, version));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  const u = (await db.query('SELECT id, calendar_token_version FROM users WHERE id = $1', [Number(id)])).rows[0];
  if (!u || Number(u.calendar_token_version) !== Number(version)) return null;
  return u;
}

const feedBase = () => `${resolveFrontendBaseUrl()}/api/calendar`;

/** GET /api/me/calendar — the caller's feed link (https, and webcal for Apple Calendar). */
async function feedInfo(userId) {
  const u = (await db.query('SELECT id, calendar_token_version FROM users WHERE id = $1', [userId])).rows[0];
  if (!u) throw httpError(404, 'User not found', 'NOT_FOUND');
  const url = `${feedBase()}/${tokenFor(u.id, u.calendar_token_version)}.ics`;
  return { url, webcal: url.replace(/^https?:/, 'webcal:') };
}

/** POST /api/me/calendar/reset — a new link; the old one stops working. */
async function resetFeed(userId) {
  await db.query('UPDATE users SET calendar_token_version = calendar_token_version + 1 WHERE id = $1', [userId]);
  return feedInfo(userId);
}

/* ── What goes in a feed ────────────────────────────────────────────────── */

function placeOf(e, w) {
  if (e.format === 'online') return w.online;
  const where = [e.venue_name, e.venue_address, e.city].filter((x) => x && String(x).trim()).join(', ');
  if (e.format === 'hybrid') return where ? `${where} / ${w.online}` : w.online;
  return where || null;
}

const pageOf = (e) => (e.slug ? `${resolveFrontendBaseUrl()}/e/${e.slug}` : resolveFrontendBaseUrl());

/**
 * The calendar entries of one event for one reader.
 * @param {object} e        events row
 * @param {object} who      { kind: 'public'|'organizer'|'judge'|'mentor'|'volunteer'|'participant', withLink, slot }
 */
function entriesOf(e, who) {
  const w = wordsFor(e.language);
  const name = e.name;
  const page = pageOf(e);
  const updated = e.updated_at || e.published_at || null;
  const link = who.withLink && e.online_url ? open(e.online_url) : null;
  const room = link ? `${w.join}: ${link}` : null;
  const description = [e.tagline || null, room, `${w.page}: ${page}`].filter(Boolean).join('\n');
  const uid = (part) => `hackos-event-${e.id}-${part}@${UID_HOST}`;
  const out = [];
  const add = (part, summary, start, end = null, extra = {}) => {
    if (!start) return;
    out.push({ uid: uid(part), summary, start, end, description, location: placeOf(e, w), url: page, updated, ...extra });
  };
  const k = who.kind;
  const any = (...kinds) => kinds.includes(k);

  add('main', name, e.start_date, e.end_date);
  if (any('public', 'organizer')) add('registration-end', fill(w.registrationCloses, name), e.registration_end);
  if (any('public', 'organizer', 'participant')) add('team-deadline', fill(w.teamDeadline, name), e.team_deadline);
  if (any('public', 'organizer', 'participant', 'mentor')) add('submission-deadline', fill(w.submissionDeadline, name), e.submission_deadline);
  if (any('organizer', 'judge')) add('judging', fill(w.judging, name), e.judging_start, e.judging_end);
  add('demo-day', fill(w.demoDay, name), e.demo_day);
  add('results', fill(w.results, name), e.results_at);
  if (k === 'participant' && who.slot?.scheduled_at) {
    const start = new Date(who.slot.scheduled_at);
    add('presentation', fill(w.presentation, name), start, new Date(start.getTime() + Math.max(1, Number(who.slot.duration) || 10) * 60e3));
  }
  return out;
}

const onPlan = async (eventId) => {
  const scope = await forEvent(eventId);
  return !scope || scope.modules.has('calendar');
};

/** GET /api/public/events/:slug/calendar.ics */
async function publicFeed(slugOrCode) {
  const key_ = String(slugOrCode || '').trim().replace(/\.ics$/i, '');
  if (!key_ || key_.length > 100) return null;
  const e = (await db.query(
    `SELECT * FROM events
      WHERE (slug = LOWER($1) OR LOWER(event_code) = LOWER($1))
        AND is_published = true AND LOWER(TRIM(COALESCE(status::text, ''))) <> 'archived'
      ORDER BY (slug = LOWER($1)) DESC LIMIT 1`,
    [key_],
  )).rows[0];
  if (!e || !(await onPlan(e.id))) return null;
  return { name: e.slug || String(e.id), ics: calendar({ name: e.name, description: e.tagline || undefined, events: entriesOf(e, { kind: 'public', withLink: false }) }) };
}

/** GET /api/calendar/<token>.ics */
async function personalFeed(token) {
  const u = await userFromToken(String(token || '').replace(/\.ics$/i, ''));
  if (!u) return null;
  const rows = (await db.query(
    `WITH roles AS (
       SELECT e.id AS event_id, 'organizer' AS kind, NULL::text AS status
         FROM events e
        WHERE e.created_by = $1
           OR EXISTS (SELECT 1 FROM customer_contacts cc WHERE cc.user_id = $1 AND cc.customer_id = e.customer_id
                       AND cc.member_role = ANY($2::text[]))
       UNION ALL SELECT event_id, 'judge', NULL FROM judges WHERE user_id = $1
       UNION ALL SELECT event_id, 'mentor', NULL FROM mentor_assignments WHERE user_id = $1
       UNION ALL SELECT event_id, 'volunteer', NULL FROM volunteers WHERE user_id = $1
       UNION ALL SELECT event_id, 'participant', LOWER(TRIM(COALESCE(status::text, 'pending'))) FROM participants WHERE user_id = $1
     )
     SELECT e.*, r.kind, r.status AS participant_status
       FROM roles r JOIN events e ON e.id = r.event_id
      WHERE LOWER(TRIM(COALESCE(e.status::text, ''))) <> 'archived'
        AND (r.kind <> 'participant' OR r.status IN ('approved', 'pending', 'waitlisted'))
      ORDER BY e.start_date`,
    [u.id, ORG_MANAGER_ROLES],
  )).rows;
  const order = ['organizer', 'judge', 'mentor', 'volunteer', 'participant'];
  const byEvent = new Map();
  for (const row of rows) {
    const had = byEvent.get(row.id);
    if (!had || order.indexOf(row.kind) < order.indexOf(had.kind)) byEvent.set(row.id, row);
  }
  const entries = [];
  for (const e of byEvent.values()) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await onPlan(e.id))) continue;
    let slot = null;
    if (e.kind === 'participant') {
      // eslint-disable-next-line no-await-in-loop
      slot = (await db.query(
        `SELECT p.scheduled_at, p.duration FROM presentations p
           JOIN team_members tm ON tm.team_id = p.team_id AND tm.user_id = $2
          WHERE p.event_id = $1 AND p.scheduled_at IS NOT NULL
          ORDER BY p.scheduled_at LIMIT 1`,
        [e.id, u.id],
      )).rows[0] || null;
    }
    const withLink = e.kind !== 'participant' || e.participant_status === 'approved';
    entries.push(...entriesOf(e, { kind: e.kind, withLink, slot }));
  }
  return calendar({ name: wordsFor(rows[0]?.language).personal, events: entries });
}

module.exports = { tokenFor, userFromToken, feedInfo, resetFeed, publicFeed, personalFeed, entriesOf };
