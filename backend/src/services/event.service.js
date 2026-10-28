/**
 * @file event.service.js
 * @description Business logic for hackathon event management.
 *
 * Handles CRUD operations on events, as well as publish/archive
 * lifecycle transitions and analytics aggregation.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { uniqueSlug } = require('./eventIdentity');

const EVENT_STATUSES = ['draft', 'upcoming', 'ongoing', 'completed', 'archived'];

/**
 * Where the event actually is in its lifecycle, worked out from its dates.
 *
 * Nothing ever moved `status` forward — no job, no trigger, no write path — so
 * every event in the live database still says `upcoming` while its dates are
 * months in the past, and the phase shown in the shell and the notifications
 * bell is wrong for all of them. Rather than overwrite a column an organiser
 * set by hand, every read carries this alongside it.
 *
 * `draft` and `archived` are deliberate states an organiser chose, so they win
 * over the dates; the rest is derived.
 */
const DERIVED_STATUS = `
  CASE
    WHEN LOWER(TRIM(COALESCE(status::text, ''))) IN ('archived', 'draft')
      THEN LOWER(TRIM(status::text))
    WHEN start_date IS NULL OR end_date IS NULL
      THEN LOWER(TRIM(COALESCE(NULLIF(status::text, ''), 'upcoming')))
    WHEN NOW() < start_date THEN 'upcoming'
    WHEN NOW() > end_date   THEN 'completed'
    ELSE 'ongoing'
  END AS derived_status`;

/** Columns safe to expose to anonymous callers (join / login pages). */
const PUBLIC_COLUMNS = `
  id, event_code, name, description,
  start_date, end_date, registration_start, registration_end,
  submission_deadline, demo_day, status, team_size_limit, min_team_size,
  is_published, allow_team_formation, require_submission, allow_late_submissions,
  slug, tagline, category, language, brand_color, logo_file_id, banner_file_id,
  format, venue_name, venue_address, city, country, map_url, timezone,
  team_deadline, judging_start, judging_end, results_at,
  registration_mode, max_participants, waitlist_enabled, eligibility, rules, faq, published_at, visibility,
  ${DERIVED_STATUS}`;

// ─────────────────────────────────────────────────────────────────────────────
// Read Operations
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch all events, newest first (signed-in users). */
const getAllEvents = async () => {
  const result = await db.query(`SELECT *, ${DERIVED_STATUS} FROM events ORDER BY start_date DESC`);
  return result.rows;
};

/**
 * Events a signed-in user is entitled to see.
 *
 * Membership is the rule: an event is visible if you created it or you appear
 * on it as a participant, judge, mentor or volunteer. Before this existed
 * `getAllEvents` was handed to every authenticated caller, so a hacker
 * registered for one hackathon received every hackathon on the installation —
 * including unpublished drafts belonging to other customers.
 *
 * Callers with an owner role skip this entirely and get `getAllEvents`.
 *
 * A colleague at the same customer counts as a member too, which is the clause
 * `customer_contacts` adds. That is what makes an invited organiser able to
 * administer an event they did not personally create — the gap that kept
 * `admin` unscoped until events had an owning customer.
 *
 * `includeUnassigned` widens the rule to events with no customer at all. Only
 * a single-organisation installation turns it on (LEGACY_SHARED_EVENTS, see
 * tenantAccess.service); anywhere strangers can become organisers it would
 * hand them every unassigned event.
 */
const getEventsVisibleTo = async (userId, { includeUnassigned = false } = {}) => {
  const result = await db.query(
    `SELECT e.*, ${DERIVED_STATUS}
       FROM events e
      WHERE e.created_by = $1
         OR EXISTS (SELECT 1 FROM participants        m WHERE m.event_id = e.id AND m.user_id = $1)
         OR EXISTS (SELECT 1 FROM judges              m WHERE m.event_id = e.id AND m.user_id = $1)
         OR EXISTS (SELECT 1 FROM mentor_assignments  m WHERE m.event_id = e.id AND m.user_id = $1)
         OR EXISTS (SELECT 1 FROM volunteers          m WHERE m.event_id = e.id AND m.user_id = $1)
         OR EXISTS (SELECT 1 FROM customer_contacts  cc
                     WHERE cc.user_id = $1 AND cc.customer_id = e.customer_id)
         OR ($2 = true AND e.customer_id IS NULL)
      ORDER BY e.start_date DESC`,
    [userId, includeUnassigned === true],
  );
  return result.rows;
};

/**
 * Whether one user may see one event — the single-event form of the rule above.
 */
const canUserSeeEvent = async (userId, eventId, { includeUnassigned = false } = {}) => {
  const result = await db.query(
    `SELECT 1
       FROM events e
      WHERE e.id = $1
        AND (e.created_by = $2
             OR EXISTS (SELECT 1 FROM participants       m WHERE m.event_id = e.id AND m.user_id = $2)
             OR EXISTS (SELECT 1 FROM judges             m WHERE m.event_id = e.id AND m.user_id = $2)
             OR EXISTS (SELECT 1 FROM mentor_assignments m WHERE m.event_id = e.id AND m.user_id = $2)
             OR EXISTS (SELECT 1 FROM volunteers         m WHERE m.event_id = e.id AND m.user_id = $2)
             OR EXISTS (SELECT 1 FROM customer_contacts cc
                         WHERE cc.user_id = $2 AND cc.customer_id = e.customer_id)
             OR ($3 = true AND e.customer_id IS NULL))
      LIMIT 1`,
    [eventId, userId, includeUnassigned === true],
  );
  return result.rows.length > 0;
};

/**
 * The registration a participant works in when nothing names an event (no
 * eventId, no workspace entered): one the organiser admitted them to first,
 * then one running now, then the next to start, then the latest finished.
 * Archived events never. The same pick decides the event the participant
 * pages act in and the approval status the sign-in reports, so one person
 * approved in one hackathon and pending in the next is not locked out of the
 * first. (The web app's participantEventId picks in the same order.)
 *
 * @returns {Promise<{ event_id: number, status: string } | null>}
 */
const defaultParticipation = async (userId, exec = db) => {
  const result = await exec.query(
    `SELECT p.event_id, LOWER(TRIM(COALESCE(p.status::text, 'pending'))) AS status
       FROM participants p
       JOIN events e ON e.id = p.event_id
      WHERE p.user_id = $1
        AND LOWER(TRIM(COALESCE(e.status::text, ''))) <> 'archived'
      ORDER BY (LOWER(TRIM(COALESCE(p.status::text, 'pending'))) IN ('approved', 'eliminated')) DESC,
               CASE WHEN e.start_date <= NOW() AND COALESCE(e.end_date, e.start_date) >= NOW() THEN 0
                    WHEN e.start_date > NOW() THEN 1 ELSE 2 END,
               CASE WHEN e.start_date > NOW() THEN e.start_date END ASC NULLS LAST,
               e.start_date DESC NULLS LAST, e.id DESC
      LIMIT 1`,
    [userId],
  );
  return result.rows[0] || null;
};

/**
 * The event a hacker is acting in when they do not say: their registration
 * by defaultParticipation. Falls back to the platform's active event only for
 * someone registered nowhere, so two events running at once no longer make
 * one team's submission vanish.
 */
const getDefaultEventForUser = async (userId) => {
  const own = await defaultParticipation(userId);
  if (own) return getEventById(own.event_id);
  // Registered nowhere: only an event its organiser has published, never a draft.
  return getActiveEvent({ publishedOnly: true });
};

/**
 * The customers a signed-in account belongs to, via `customer_contacts`.
 *
 * Usually zero or one. It is a list because nothing stops the same person being
 * the contact for two organisations, and a query that assumed one would quietly
 * show them only half of their work.
 */
const getCustomerIdsForUser = async (userId) => {
  const result = await db.query(
    'SELECT DISTINCT customer_id FROM customer_contacts WHERE user_id = $1',
    [userId],
  );
  return result.rows.map((r) => r.customer_id);
};

/** One published event, public columns only — what an anonymous caller may read. */
const getPublicEventByIdentifier = async (identifier) => {
  const isNumeric = /^\d+$/.test(String(identifier));
  const result = await db.query(
    `SELECT ${PUBLIC_COLUMNS}
       FROM events
      WHERE ${isNumeric ? 'id = $1' : 'LOWER(event_code) = LOWER($1)'}
        AND is_published = true
        AND LOWER(TRIM(COALESCE(status::text, ''))) <> 'archived'
      LIMIT 1`,
    [isNumeric ? Number(identifier) : String(identifier).trim()],
  );
  return result.rows[0] || null;
};

/**
 * Published, non-archived events with public columns only (anonymous users).
 * A private or invite-only event is reached by its link, never by a list.
 */
const getPublicEvents = async () => {
  const result = await db.query(
    `SELECT ${PUBLIC_COLUMNS}
       FROM events
      WHERE is_published = true
        AND visibility = 'public'
        AND LOWER(TRIM(COALESCE(status::text, ''))) <> 'archived'
      ORDER BY start_date DESC`,
  );
  return result.rows;
};

/**
 * The event the app should show when the caller did not name one.
 *
 * Picks, in order: the event running right now, else the soonest upcoming one,
 * else the most recently finished one. Archived events are never chosen.
 *
 * The last tier matters: this used to require `end_date >= NOW()`, so the day a
 * hackathon ended every participant's dashboard went blank — their team, their
 * submission and the results all disappeared, which is exactly when people come
 * back to look at them.
 */
const getActiveEvent = async ({ amongIds = null, publishedOnly = false } = {}) => {
  // amongIds limits the pick to events the caller may see; null = all.
  const result = await db.query(
    `SELECT *, ${DERIVED_STATUS} FROM events
     WHERE LOWER(TRIM(COALESCE(status::text, ''))) <> 'archived'
       AND ($1::int[] IS NULL OR id = ANY($1::int[]))
       AND ($2::boolean = false OR is_published = true)
     ORDER BY
       CASE
         WHEN start_date <= NOW() AND end_date >= NOW() THEN 0   -- running now
         WHEN start_date > NOW()                        THEN 1   -- upcoming
         ELSE 2                                                  -- finished
       END,
       CASE WHEN start_date > NOW() THEN start_date END ASC NULLS LAST,
       end_date DESC
     LIMIT 1`,
    [amongIds, publishedOnly === true],
  );
  return result.rows[0];
};

/**
 * Latest non-archived event (by id). Used when Telegram / sync needs an
 * event bucket but `getActiveEvent` returns nothing (e.g. dates past end_date).
 */
const getLatestNonArchivedEvent = async () => {
  const result = await db.query(
    `SELECT *, ${DERIVED_STATUS} FROM events
     WHERE COALESCE(LOWER(TRIM(status)), '') != 'archived'
     ORDER BY id DESC
     LIMIT 1`,
  );
  return result.rows[0];
};

const getEventByCode = async (code) => {
  const result = await db.query(`SELECT *, ${DERIVED_STATUS} FROM events WHERE event_code = $1`, [code]);
  return result.rows[0];
};

const getEventById = async (id) => {
  const result = await db.query(`SELECT *, ${DERIVED_STATUS} FROM events WHERE id = $1`, [id]);
  return result.rows[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// Validation / normalisation
// ─────────────────────────────────────────────────────────────────────────────

const pick = (data, ...keys) => {
  for (const k of keys) {
    if (data[k] !== undefined) return data[k];
  }
  return undefined;
};

const toBool = (v, fallback) => {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  return fallback;
};

const toDate = (v, field) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw httpError(400, `${field} is not a valid date`, 'VALIDATION_ERROR', { errors: [{ field, message: 'Not a valid date.' }] });
  }
  return d;
};

const toInt = (v, field, { min, max, fallback }) => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n)) {
    throw httpError(400, `${field} must be a whole number`, 'VALIDATION_ERROR', { errors: [{ field, message: 'Must be a whole number.' }] });
  }
  if (n < min || n > max) {
    throw httpError(400, `${field} must be between ${min} and ${max}`, 'VALIDATION_ERROR', { errors: [{ field, message: `Must be from ${min} to ${max}.` }] });
  }
  return n;
};

/**
 * Normalise + validate an event payload (camelCase or snake_case accepted).
 * `existing` supplies fallbacks for PATCH-style updates.
 */
function normalizeEventInput(data, existing = null, { lifecycle = existing == null } = {}) {
  const raw = data && typeof data === 'object' ? data : {};
  /*
   * Publishing goes through POST /:id/publish, which checks the event is
   * complete and takes it from the organisation's plan; archiving has its
   * own route too. An update that could set is_published or status walked
   * around both, so updates keep the stored values.
   */
  const src = lifecycle ? raw : Object.fromEntries(
    Object.entries(raw).filter(([k]) => !['is_published', 'isPublished', 'status'].includes(k)),
  );
  const ex = existing || {};

  const name = pick(src, 'name', 'eventName') !== undefined
    ? String(pick(src, 'name', 'eventName')).trim()
    : ex.name;
  if (!name) throw httpError(400, 'Event name is required', 'VALIDATION_ERROR', { errors: [{ field: 'name', message: 'Required.' }] });
  if (name.length > 255) throw httpError(400, 'Event name must be 255 characters or fewer', 'VALIDATION_ERROR', { errors: [{ field: 'name', message: 'Must be 255 characters or fewer.' }] });

  const rawCode = pick(src, 'event_code', 'eventCode');
  const event_code = rawCode !== undefined ? String(rawCode).trim() : ex.event_code;
  if (!event_code) throw httpError(400, 'Event code is required', 'VALIDATION_ERROR');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,99}$/.test(event_code)) {
    throw httpError(400, 'Event code may only contain letters, numbers, "-" and "_" (2-100 chars)', 'VALIDATION_ERROR');
  }

  const description = pick(src, 'description') !== undefined
    ? (pick(src, 'description') == null ? null : String(pick(src, 'description')))
    : (ex.description ?? null);

  const start_date = toDate(pick(src, 'start_date', 'startDate'), 'start_date') ?? ex.start_date ?? undefined;
  const end_date   = toDate(pick(src, 'end_date', 'endDate'), 'end_date') ?? ex.end_date ?? undefined;
  if (!start_date) throw httpError(400, 'start_date is required', 'VALIDATION_ERROR', { errors: [{ field: 'start_date', message: 'Required.' }] });
  if (!end_date) throw httpError(400, 'end_date is required', 'VALIDATION_ERROR', { errors: [{ field: 'end_date', message: 'Required.' }] });
  if (new Date(end_date) <= new Date(start_date)) {
    throw httpError(400, 'end_date must be after start_date', 'VALIDATION_ERROR', { errors: [{ field: 'end_date', message: 'The event must end after it starts.' }] });
  }

  const registration_start  = toDate(pick(src, 'registration_start', 'registrationStart'), 'registration_start');
  const registration_end    = toDate(pick(src, 'registration_end', 'registrationEnd'), 'registration_end');
  const submission_deadline = toDate(pick(src, 'submission_deadline', 'submissionDeadline'), 'submission_deadline');
  const demo_day            = toDate(pick(src, 'demo_day', 'demoDay'), 'demo_day');

  const finalRegStart = registration_start !== undefined ? registration_start : (ex.registration_start ?? null);
  const finalRegEnd   = registration_end   !== undefined ? registration_end   : (ex.registration_end ?? null);
  const finalDeadline = submission_deadline !== undefined ? submission_deadline : (ex.submission_deadline ?? null);
  if (finalRegStart && finalRegEnd && new Date(finalRegEnd) < new Date(finalRegStart)) {
    throw httpError(400, 'registration_end must be after registration_start', 'VALIDATION_ERROR', { errors: [{ field: 'registration_end', message: 'Registration must close after it opens.' }] });
  }

  /*
   * The dates have to line up with each other, not just pairwise: only
   * `end_date > start_date` was ever checked, and the live database ended up
   * with an event whose registration closed a week *after* the hackathon
   * finished.
   *
   * How a violation is handled depends on who caused it:
   *
   *   - The caller sent the dependent date itself (`registration_end` past the
   *     event's end) — that is bad input, so it is refused.
   *   - The caller only moved the boundary (`end_date` pulled earlier, leaving
   *     a stored `registration_end` stranded past it) — the dependent date is
   *     pulled along with it. Refusing here would mean an organiser shortening
   *     an event gets an error about a field they never touched.
   *   - Neither was sent (a rename, say) — nothing is checked at all, so the
   *     rows already holding contradictory dates stay editable.
   */
  const supplied = (...keys) => keys.some((k) => pick(src, k) !== undefined);
  const isNew = existing == null;
  const clampToBoundary = (value, boundary, ownKeys, boundaryKeys, message) => {
    if (!value || !boundary) return value;
    if (new Date(value) <= new Date(boundary)) return value;
    if (isNew || supplied(...ownKeys)) {
      throw httpError(400, message, 'VALIDATION_ERROR', { errors: [{ field: ownKeys[0], message }] });
    }
    if (supplied(...boundaryKeys)) return boundary;
    return value;
  };

  const clampedRegEnd = clampToBoundary(
    finalRegEnd, end_date,
    ['registration_end', 'registrationEnd'], ['end_date', 'endDate'],
    'registration_end cannot be after end_date',
  );
  const clampedDeadline = clampToBoundary(
    finalDeadline, end_date,
    ['submission_deadline', 'submissionDeadline'], ['end_date', 'endDate'],
    'submission_deadline cannot be after end_date',
  );
  const clampedRegStart = clampToBoundary(
    finalRegStart, start_date,
    ['registration_start', 'registrationStart'], ['start_date', 'startDate'],
    'registration_start cannot be after start_date',
  );

  const team_size_limit = toInt(pick(src, 'team_size_limit', 'teamSizeLimit', 'maxTeamSize'), 'team_size_limit', {
    min: 1, max: 50, fallback: ex.team_size_limit ?? 4,
  });
  let min_team_size = toInt(pick(src, 'min_team_size', 'minTeamSize'), 'min_team_size', {
    min: 1, max: 50, fallback: ex.min_team_size ?? 1,
  });
  if (min_team_size > team_size_limit) min_team_size = team_size_limit;

  const rawStatus = pick(src, 'status');
  const status = rawStatus !== undefined && rawStatus !== null && String(rawStatus).trim() !== ''
    ? String(rawStatus).trim().toLowerCase()
    : (ex.status || 'upcoming');
  if (!EVENT_STATUSES.includes(status)) {
    throw httpError(400, `status must be one of: ${EVENT_STATUSES.join(', ')}`, 'VALIDATION_ERROR', { errors: [{ field: 'status', message: 'Unknown status.' }] });
  }

  return {
    name,
    event_code,
    description,
    start_date,
    end_date,
    registration_start: clampedRegStart,
    registration_end: clampedRegEnd,
    submission_deadline: clampedDeadline,
    demo_day: demo_day !== undefined ? demo_day : (ex.demo_day ?? null),
    status,
    team_size_limit,
    min_team_size,
    is_published:           toBool(pick(src, 'is_published', 'isPublished'), ex.is_published ?? false),
    allow_team_formation:   toBool(pick(src, 'allow_team_formation', 'allowTeamFormation'), ex.allow_team_formation ?? true),
    require_submission:     toBool(pick(src, 'require_submission', 'requireSubmission'), ex.require_submission ?? true),
    allow_late_submissions: toBool(pick(src, 'allow_late_submissions', 'allowLateSubmissions'), ex.allow_late_submissions ?? false),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Write Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new event. Accepts camelCase or snake_case keys.
 * @throws 400 VALIDATION_ERROR, 409 (duplicate event_code via errorMw)
 */
/**
 * The builder's timeline rules (eventBuilderInput.reconcileTimeline) for the
 * plain create and update routes: a date the caller sent out of order is
 * refused the same way. These routes write only the core dates, so nothing
 * is pulled along here; a contradiction left in a stored date shows on the
 * publish checklist instead.
 */
const DATE_KEYS = {
  start_date: ['start_date', 'startDate'], end_date: ['end_date', 'endDate'],
  registration_start: ['registration_start', 'registrationStart'], registration_end: ['registration_end', 'registrationEnd'],
  submission_deadline: ['submission_deadline', 'submissionDeadline'], demo_day: ['demo_day', 'demoDay'],
};
function assertTimeline(v, data, existing = null) {
  // eslint-disable-next-line global-require
  const { reconcileTimeline } = require('./eventBuilderInput');
  const src = data && typeof data === 'object' ? data : {};
  const supplied = new Set(Object.entries(DATE_KEYS)
    .filter(([, keys]) => keys.some((k) => src[k] !== undefined))
    .map(([col]) => col));
  if (!supplied.size) return;
  const { errors } = reconcileTimeline({ ...(existing || {}), ...v }, supplied);
  if (errors.length) throw httpError(400, errors[0].message, 'VALIDATION_ERROR', { errors });
}

const createEvent = async (data) => {
  const v = normalizeEventInput(data);
  assertTimeline(v, data);
  const slug = await uniqueSlug(v.event_code || v.name);
  const result = await db.query(
    `INSERT INTO events (
       event_code, name, description, start_date, end_date,
       registration_start, registration_end, submission_deadline, demo_day,
       status, team_size_limit, min_team_size,
       is_published, allow_team_formation, require_submission, allow_late_submissions,
       created_by, slug, published_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             CASE WHEN $13 THEN now() END)
     RETURNING *`,
    [
      v.event_code, v.name, v.description, v.start_date, v.end_date,
      v.registration_start, v.registration_end, v.submission_deadline, v.demo_day,
      v.status, v.team_size_limit, v.min_team_size,
      v.is_published, v.allow_team_formation, v.require_submission, v.allow_late_submissions,
      data.created_by ?? null, slug,
    ],
  );
  return result.rows[0];
};

/**
 * Update event fields (PATCH semantics — unset fields keep their values).
 * @returns {Promise<object|null>} Updated event row, or null if not found
 */
const updateEvent = async (id, data) => {
  const existing = await getEventById(id);
  if (!existing) return null;

  const v = normalizeEventInput(data, existing);
  assertTimeline(v, data, existing);
  const result = await db.query(
    `UPDATE events
        SET event_code=$1, name=$2, description=$3, start_date=$4, end_date=$5,
            registration_start=$6, registration_end=$7, submission_deadline=$8, demo_day=$9,
            status=$10, team_size_limit=$11, min_team_size=$12,
            is_published=$13, allow_team_formation=$14, require_submission=$15,
            allow_late_submissions=$16, updated_at=CURRENT_TIMESTAMP
      WHERE id=$17
      RETURNING *`,
    [
      v.event_code, v.name, v.description, v.start_date, v.end_date,
      v.registration_start, v.registration_end, v.submission_deadline, v.demo_day,
      v.status, v.team_size_limit, v.min_team_size,
      v.is_published, v.allow_team_formation, v.require_submission,
      v.allow_late_submissions,
      id,
    ],
  );
  return result.rows[0];
};

const deleteEvent = async (id) => {
  const result = await db.query(
    'DELETE FROM events WHERE id=$1 RETURNING id, entitlement_id, is_published',
    [id],
  );
  if (!result.rows[0]) {
    throw httpError(404, 'Event not found', 'NOT_FOUND');
  }
  return result.rows[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle Transitions
// ─────────────────────────────────────────────────────────────────────────────

/** Publish an event: visible on public pages. Status leaves 'draft'/'archived'. */
const publishEvent = async (id) => {
  const result = await db.query(
    `UPDATE events
        SET is_published = true,
            status = CASE
              WHEN status IN ('draft', 'archived') THEN 'upcoming'
              ELSE status
            END,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *`,
    [id],
  );
  return result.rows[0];
};

const archiveEvent = async (id) => {
  const result = await db.query(
    `UPDATE events SET status='archived', updated_at=CURRENT_TIMESTAMP
     WHERE id=$1 RETURNING *`,
    [id],
  );
  return result.rows[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────

const getEventAnalytics = async (eventId) => {
  const [participantsResult, teamsResult, submissionsResult] = await Promise.all([
    db.query('SELECT COUNT(DISTINCT user_id) AS participant_count FROM participants WHERE event_id=$1', [eventId]),
    db.query('SELECT COUNT(*) AS team_count FROM teams WHERE event_id=$1', [eventId]),
    db.query('SELECT COUNT(*) AS submission_count FROM submissions WHERE event_id=$1', [eventId]),
  ]);

  return {
    participants: parseInt(participantsResult.rows[0].participant_count, 10),
    teams:        parseInt(teamsResult.rows[0].team_count, 10),
    submissions:  parseInt(submissionsResult.rows[0].submission_count, 10),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle helpers
// ─────────────────────────────────────────────────────────────────────────────

/** True when the event has reached or passed its scheduled start_date. */
const hasEventStarted = (eventRow) => {
  if (!eventRow || !eventRow.start_date) return false;
  const startMs = new Date(eventRow.start_date).getTime();
  if (!Number.isFinite(startMs)) return false;
  return startMs <= Date.now();
};

/**
 * Throws a 403 if team membership may no longer change for this event: its
 * team deadline (or, without one, its start) has passed, or the organiser
 * disabled team formation.
 */
/**
 * Whether teams can still change, and until when: the organiser's team
 * deadline when there is one (it may fall after the start), else the start.
 */
const teamFormationState = (event) => {
  if (!event || event.allow_team_formation === false) return { open: false, closesAt: null };
  const closesAt = event.team_deadline || event.start_date || null;
  const open = event.team_deadline
    ? new Date(event.team_deadline).getTime() > Date.now()
    : !hasEventStarted(event);
  return { open, closesAt: closesAt ? new Date(closesAt).toISOString() : null };
};

const assertTeamFormationOpen = async (eventId) => {
  const event = await getEventById(eventId);
  if (!event) {
    throw httpError(404, 'Event not found', 'NOT_FOUND');
  }
  if (event.allow_team_formation === false) {
    throw httpError(403, 'Team formation is disabled for this event.', 'TEAM_FORMATION_CLOSED');
  }
  // The organiser's team deadline when there is one (it may fall after the
  // start), else the start itself — the same cut-off registration uses.
  if (event.team_deadline) {
    if (new Date(event.team_deadline).getTime() <= Date.now()) {
      throw httpError(
        403,
        'Team formation for this event has closed. You can only stay with your current team.',
        'TEAM_FORMATION_CLOSED',
      );
    }
  } else if (hasEventStarted(event)) {
    throw httpError(
      403,
      'Team formation is closed — the event has already started. You can only stay with your current team.',
      'TEAM_FORMATION_CLOSED',
    );
  }
  return event;
};

module.exports = {
  EVENT_STATUSES,
  getAllEvents,
  getEventsVisibleTo,
  canUserSeeEvent,
  getCustomerIdsForUser,
  getPublicEventByIdentifier,
  getPublicEvents,
  getActiveEvent,
  defaultParticipation,
  getDefaultEventForUser,
  getLatestNonArchivedEvent,
  getEventByCode,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  publishEvent,
  archiveEvent,
  getEventAnalytics,
  hasEventStarted,
  teamFormationState,
  assertTeamFormationOpen,
  normalizeEventInput,
};
