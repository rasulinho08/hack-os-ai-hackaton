/**
 * @file eventArchive.service.js
 * @description Archiving an event and taking everything in it home.
 *
 * Decision E13: an event is archived by itself 14 days after it ends (or by
 * the organiser earlier), and from then on it can only be read — the guard
 * in middlewares/archiveGuard.js refuses every change. The organiser can
 * bring it back. The ZIP export holds the event's settings, its people,
 * teams, projects, scores, results, certificates, announcements, help
 * requests and feedback as spreadsheet-safe CSV, plus the files people
 * uploaded (up to a size limit, the rest listed).
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { toCsv } = require('../utils/csv');
const { zip } = require('../utils/zip');
const audit = require('./audit.service');

const ARCHIVE_AFTER_DAYS = 14;
const FILES_LIMIT_BYTES = (Number(process.env.EXPORT_FILES_MAX_MB) || 25) * 1024 * 1024;

const ARCHIVED_SQL = "(archived_at IS NOT NULL OR LOWER(TRIM(COALESCE(status::text, ''))) = 'archived')";

async function archive(eventId, actorId = null, { auto = false } = {}) {
  const r = await db.query(
    `UPDATE events SET status = 'archived', archived_at = COALESCE(archived_at, now()), updated_at = now()
      WHERE id = $1 RETURNING id, archived_at`,
    [eventId],
  );
  if (!r.rows[0]) throw httpError(404, 'Event not found', 'NOT_FOUND');
  if (auto) {
    await audit.record(null, 'event.archived', { eventId, targetType: 'event', targetId: eventId, actorId, meta: { auto: true } });
  }
  return r.rows[0];
}

/** Back from the archive: published events show their dates' phase again, others are drafts. */
async function unarchive(eventId) {
  const r = await db.query(
    `UPDATE events SET archived_at = NULL, updated_at = now(),
            status = CASE WHEN is_published THEN 'upcoming' ELSE 'draft' END
      WHERE id = $1 RETURNING id, status, is_published`,
    [eventId],
  );
  if (!r.rows[0]) throw httpError(404, 'Event not found', 'NOT_FOUND');
  return r.rows[0];
}

/**
 * Archive published events that ended more than 14 days ago. A draft is not
 * archived by itself: it may be an event still being prepared on old dates.
 * An event the organiser brought back after its automatic archiving stays
 * out (its audit trail says so).
 * @returns {Promise<number[]>} the ids archived
 */
async function autoArchive(now = new Date()) {
  const r = await db.query(
    `UPDATE events e SET status = 'archived', archived_at = now(), updated_at = now()
      WHERE e.archived_at IS NULL AND LOWER(TRIM(COALESCE(e.status::text, ''))) <> 'archived'
        AND e.is_published = true AND e.end_date IS NOT NULL
        AND e.end_date < $1::timestamptz - make_interval(days => $2::int)
        AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.event_id = e.id AND a.action = 'event.unarchived')
      RETURNING e.id`,
    [now.toISOString(), ARCHIVE_AFTER_DAYS],
  );
  const ids = r.rows.map((x) => Number(x.id));
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    await audit.record(null, 'event.archived', { eventId: id, targetType: 'event', targetId: id, meta: { auto: true } });
  }
  return ids;
}

async function isArchived(eventId) {
  const r = await db.query(`SELECT 1 FROM events WHERE id = $1 AND ${ARCHIVED_SQL}`, [eventId]);
  return Boolean(r.rows[0]);
}

/* ── The export ──────────────────────────────────────────────────────────── */

const iso = (d) => (d ? new Date(d).toISOString() : '');

async function eventJson(eventId) {
  const e = (await db.query(
    `SELECT id, name, slug, event_code, tagline, description, category, language, format, venue_name, venue_address, city,
            country, timezone, registration_start, registration_end, start_date, end_date, team_deadline, submission_deadline,
            judging_start, judging_end, demo_day, results_published_at, archived_at, is_published, published_at,
            team_size_limit, min_team_size, max_participants, registration_mode, rules, faq,
            judging_config, submission_config, certificate_config
       FROM events WHERE id = $1`,
    [eventId],
  )).rows[0];
  if (!e) throw httpError(404, 'Event not found', 'NOT_FOUND');
  const [tracks, prizes, criteria] = await Promise.all([
    db.query('SELECT id, name, description FROM tracks WHERE event_id = $1 ORDER BY sort_order, id', [eventId]),
    db.query('SELECT id, kind, position, name, description, value, track_id, winner_team_id FROM prizes WHERE event_id = $1 ORDER BY sort_order, id', [eventId]),
    db.query('SELECT id, name, description, max_score, weight FROM scoring_criteria WHERE event_id = $1 ORDER BY sort_order NULLS LAST, id', [eventId]),
  ]);
  return { ...e, tracks: tracks.rows, prizes: prizes.rows, criteria: criteria.rows };
}

async function teamsCsv(eventId) {
  const r = await db.query(
    `SELECT t.id, t.name, COALESCE(t.status, 'active') AS status, t.created_at, t.elimination_reason, t.eliminated_at,
            er.name AS round_name, tr.name AS track_name, lu.full_name AS leader,
            (SELECT string_agg(u.full_name, '; ' ORDER BY u.full_name) FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = t.id) AS members
       FROM teams t
       LEFT JOIN users lu ON lu.id = t.leader_id
       LEFT JOIN tracks tr ON tr.id = t.track_id
       LEFT JOIN elimination_rounds er ON er.id = t.eliminated_round_id
      WHERE t.event_id = $1 ORDER BY t.id`,
    [eventId],
  );
  return toCsv([
    { key: 'name', header: 'Team' }, { key: 'status', header: 'Status' }, { key: 'leader', header: 'Leader' },
    { key: 'members', header: 'Members' }, { key: 'track_name', header: 'Track' },
    { header: 'Created', value: (x) => iso(x.created_at) }, { key: 'round_name', header: 'Eliminated in' },
    { key: 'elimination_reason', header: 'Reason' }, { header: 'Eliminated at', value: (x) => iso(x.eliminated_at) },
  ], r.rows);
}

async function submissionsCsv(eventId) {
  const r = await db.query(
    `SELECT s.id, t.name AS team_name, s.project_name, s.description, s.tech_stack, s.repo_link, s.demo_link,
            s.video_link, s.presentation_link, s.status, s.submitted_at, s.updated_at, tr.name AS track_name,
            rc.status AS repo_status, rc.flags AS repo_flags
       FROM submissions s JOIN teams t ON t.id = s.team_id LEFT JOIN tracks tr ON tr.id = s.track_id
       LEFT JOIN submission_repo_checks rc ON rc.submission_id = s.id
      WHERE s.event_id = $1 ORDER BY s.submitted_at NULLS LAST, s.id`,
    [eventId],
  );
  return toCsv([
    { key: 'team_name', header: 'Team' }, { key: 'project_name', header: 'Project' }, { key: 'track_name', header: 'Track' },
    { key: 'description', header: 'Description' }, { key: 'tech_stack', header: 'Built with' },
    { key: 'repo_link', header: 'Repository' }, { key: 'demo_link', header: 'Demo' }, { key: 'video_link', header: 'Video' },
    { key: 'presentation_link', header: 'Slides' }, { key: 'status', header: 'Status' },
    { header: 'Submitted', value: (x) => iso(x.submitted_at) }, { header: 'Last change', value: (x) => iso(x.updated_at) },
    { header: 'GitHub check', value: (x) => (x.repo_status ? [x.repo_status, ...(x.repo_flags || [])].join(' ') : '') },
  ], r.rows);
}

async function scoresCsv(eventId) {
  const r = await db.query(
    `SELECT u.full_name AS judge, t.name AS team_name, s.project_name, c.name AS criterion, sc.score, c.max_score, c.weight,
            jr.feedback, sc.updated_at
       FROM scores sc
       JOIN judges j ON j.id = sc.judge_id
       JOIN users u ON u.id = j.user_id
       JOIN submissions s ON s.id = sc.submission_id AND s.event_id = $1
       JOIN teams t ON t.id = s.team_id
       JOIN scoring_criteria c ON c.id = sc.criterion_id
       LEFT JOIN judge_reviews jr ON jr.judge_id = sc.judge_id AND jr.submission_id = sc.submission_id
      WHERE j.event_id = $1
      ORDER BY t.name, u.full_name, c.sort_order NULLS LAST, c.id`,
    [eventId],
  );
  return toCsv([
    { key: 'judge', header: 'Judge' }, { key: 'team_name', header: 'Team' }, { key: 'project_name', header: 'Project' },
    { key: 'criterion', header: 'Criterion' }, { header: 'Score', value: (x) => Number(x.score) },
    { header: 'Out of', value: (x) => Number(x.max_score) }, { header: 'Weight', value: (x) => Number(x.weight) },
    { key: 'feedback', header: 'Written feedback' }, { header: 'Saved', value: (x) => iso(x.updated_at) },
  ], r.rows);
}

async function resultsCsv(eventId) {
  // eslint-disable-next-line global-require
  const results = require('./results.service');
  const published = (await db.query('SELECT results_published_at FROM events WHERE id = $1', [eventId])).rows[0]?.results_published_at;
  const rows = published ? await results.snapshot(eventId) : (await results.ranking(eventId)).ranked;
  return toCsv([
    { header: 'Place', value: (x) => Number(x.place) }, { key: 'teamName', header: 'Team' }, { key: 'projectName', header: 'Project' },
    { header: 'Score (of 100)', value: (x) => (x.score == null ? '' : Number(x.score)) }, { header: 'Judges', value: (x) => Number(x.judgesCount) },
    { header: 'Published', value: () => (published ? iso(published) : 'no — live ranking') },
  ], rows);
}

async function certificatesCsv(eventId) {
  // eslint-disable-next-line global-require
  const { verifyUrl } = require('./certificate.service');
  const r = await db.query(
    `SELECT c.code, c.kind, c.recipient_name, t.name AS team_name, c.place, c.title, c.issued_at, c.emailed_at, c.revoked_at
       FROM certificates c LEFT JOIN teams t ON t.id = c.team_id WHERE c.event_id = $1 ORDER BY c.kind, c.recipient_name`,
    [eventId],
  );
  return toCsv([
    { key: 'code', header: 'Code' }, { key: 'kind', header: 'Kind' }, { key: 'recipient_name', header: 'Name' },
    { key: 'team_name', header: 'Team' }, { key: 'place', header: 'Place' }, { key: 'title', header: 'Prize' },
    { header: 'Issued', value: (x) => iso(x.issued_at) }, { header: 'E-mailed', value: (x) => iso(x.emailed_at) },
    { header: 'Revoked', value: (x) => iso(x.revoked_at) }, { header: 'Check at', value: (x) => verifyUrl(x.code) },
  ], r.rows);
}

async function announcementsCsv(eventId) {
  const r = await db.query(
    `SELECT a.title, a.content, a.audience, a.status, a.channels, a.scheduled_at, a.sent_at, a.created_at, u.full_name AS author
       FROM announcements a LEFT JOIN users u ON u.id = a.author_id WHERE a.event_id = $1 ORDER BY a.created_at`,
    [eventId],
  );
  return toCsv([
    { key: 'title', header: 'Title' }, { key: 'content', header: 'Text' }, { key: 'audience', header: 'Audience' },
    { key: 'channels', header: 'Channels' }, { key: 'status', header: 'Status' }, { key: 'author', header: 'Author' },
    { header: 'Created', value: (x) => iso(x.created_at) }, { header: 'Scheduled', value: (x) => iso(x.scheduled_at) },
    { header: 'Sent', value: (x) => iso(x.sent_at) },
  ], r.rows);
}

async function helpCsv(eventId) {
  const r = await db.query(
    `SELECT h.topic, h.description, h.status, h.priority, t.name AS team_name, ru.full_name AS asked_by,
            mu.full_name AS mentor, h.created_at, h.claimed_at, h.resolved_at, h.closed_reason
       FROM help_tickets h
       LEFT JOIN teams t ON t.id = h.team_id
       LEFT JOIN users ru ON ru.id = h.requester_id
       LEFT JOIN users mu ON mu.id = h.mentor_id
      WHERE h.event_id = $1 ORDER BY h.created_at`,
    [eventId],
  );
  return toCsv([
    { key: 'topic', header: 'Topic' }, { key: 'description', header: 'Question' }, { key: 'status', header: 'Status' },
    { key: 'priority', header: 'Priority' }, { key: 'team_name', header: 'Team' }, { key: 'asked_by', header: 'Asked by' },
    { key: 'mentor', header: 'Mentor' }, { header: 'Asked', value: (x) => iso(x.created_at) },
    { header: 'Taken', value: (x) => iso(x.claimed_at) }, { header: 'Resolved', value: (x) => iso(x.resolved_at) },
    { key: 'closed_reason', header: 'Closed because' },
  ], r.rows);
}

async function feedbackCsvs(eventId) {
  const [general, nps] = await Promise.all([
    db.query(
      `SELECT f.type, f.rating, f.comment, f.created_at, u.full_name
         FROM feedback f JOIN users u ON u.id = f.user_id
        WHERE f.event_id = $1 AND COALESCE(f.type, '') <> 'nps' ORDER BY f.created_at`,
      [eventId],
    ),
    // NPS answers are anonymous to the organiser, here as on the page.
    db.query("SELECT nps, comment, created_at FROM feedback WHERE event_id = $1 AND type = 'nps' ORDER BY created_at", [eventId]),
  ]);
  return {
    feedback: toCsv([
      { key: 'full_name', header: 'Name' }, { key: 'type', header: 'Topic' }, { key: 'rating', header: 'Rating (1–5)' },
      { key: 'comment', header: 'Comment' }, { header: 'Sent', value: (x) => iso(x.created_at) },
    ], general.rows),
    nps: toCsv([
      { header: 'Score (0–10)', value: (x) => Number(x.nps) }, { key: 'comment', header: 'Comment' },
      { header: 'Sent', value: (x) => iso(x.created_at) },
    ], nps.rows),
  };
}

async function votesCsv(eventId) {
  // eslint-disable-next-line global-require
  const { tally } = require('./voting.service');
  const t = await tally(eventId);
  return toCsv([
    { key: 'teamName', header: 'Team' }, { key: 'projectName', header: 'Project' }, { key: 'track', header: 'Track' },
    { header: 'Votes', value: (x) => Number(x.votes) }, { header: 'Share (%)', value: (x) => Number(x.share) },
  ], t.tally);
}

/** Uploaded files of the event (projects and registration answers), largest last, up to the limit. */
async function uploadedFiles(eventId) {
  const r = await db.query(
    `SELECT f.id, f.purpose, f.filename, f.size_bytes, f.created_at,
            COALESCE(t.name, u.full_name, 'unknown') AS owner
       FROM files f
       LEFT JOIN submission_files sf ON sf.file_id = f.id
       LEFT JOIN submissions s ON s.id = sf.submission_id
       LEFT JOIN teams t ON t.id = s.team_id
       LEFT JOIN users u ON u.id = f.owner_user_id
      WHERE f.event_id = $1 AND f.purpose IN ('submission', 'registration')
        AND (f.purpose <> 'submission' OR sf.file_id IS NOT NULL)
        AND (f.purpose <> 'registration' OR f.claimed_at IS NOT NULL)
      ORDER BY f.size_bytes, f.created_at`,
    [eventId],
  );
  const taken = [];
  const skipped = [];
  const names = new Set();
  let total = 0;
  for (const f of r.rows) {
    const size = Number(f.size_bytes) || 0;
    if (total + size > FILES_LIMIT_BYTES) { skipped.push(f); continue; }
    // eslint-disable-next-line no-await-in-loop
    const bytes = (await db.query('SELECT data FROM file_blobs WHERE file_id = $1', [f.id])).rows[0]?.data;
    if (!bytes) { skipped.push(f); continue; }
    total += size;
    const folder = f.purpose === 'submission' ? 'projects' : 'registration';
    const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim().slice(0, 80) || 'file';
    let name = `files/${folder}/${safe(f.owner)}/${safe(f.filename)}`;
    if (names.has(name)) name = `files/${folder}/${safe(f.owner)}/${f.id.slice(0, 8)}-${safe(f.filename)}`;
    names.add(name);
    taken.push({ name, data: bytes, date: f.created_at });
  }
  return { taken, skipped };
}

function readme(e, files, generatedAt) {
  const lines = [
    `${e.name}`,
    ''.padEnd(String(e.name).length, '='),
    '',
    `Exported from HackOS on ${generatedAt.toISOString()}.`,
    `Event dates: ${iso(e.start_date) || '—'} – ${iso(e.end_date) || '—'}${e.archived_at ? `; archived ${iso(e.archived_at)}` : ''}.`,
    '',
    'What is inside',
    '  event.json          settings, tracks, prizes, judging criteria',
    '  participants.csv    everyone who registered, with their answers',
    '  teams.csv           teams, members, eliminations',
    '  submissions.csv     projects and their links',
    '  scores.csv          every judge\'s score per criterion, with written feedback',
    '  results.csv         the published results (or the live ranking if none were published)',
    '  certificates.csv    certificate codes and where each one can be checked',
    '  announcements.csv   what was announced, when and to whom',
    '  help-requests.csv   questions asked of mentors',
    '  feedback.csv        written feedback',
    '  nps.csv             "would you recommend it" answers (anonymous)',
    '  votes.csv           people\'s choice: votes per project',
    '  files/              files people uploaded with their projects and registrations',
    '',
    'The CSV files open in Excel, Numbers and Google Sheets. A cell that a',
    'spreadsheet would run as a formula starts with an apostrophe.',
  ];
  if (files.skipped.length) {
    lines.push('', `Files left out (over the ${Math.round(FILES_LIMIT_BYTES / 1024 / 1024)} MB limit of one export, still in HackOS):`);
    for (const f of files.skipped) lines.push(`  ${f.filename} (${Math.round((Number(f.size_bytes) || 0) / 1024)} KB, ${f.owner})`);
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** The whole event as one ZIP archive. @returns {Promise<{ name: string, data: Buffer }>} */
async function exportZip(eventId) {
  // eslint-disable-next-line global-require
  const participantAdmin = require('./participantAdmin.service');
  const generatedAt = new Date();
  const e = await eventJson(eventId);
  const [people, teams, subs, scores, res, certs, anns, help, fb, votes, files] = await Promise.all([
    participantAdmin.exportRows(eventId),
    teamsCsv(eventId), submissionsCsv(eventId), scoresCsv(eventId), resultsCsv(eventId), certificatesCsv(eventId),
    announcementsCsv(eventId), helpCsv(eventId), feedbackCsvs(eventId), votesCsv(eventId), uploadedFiles(eventId),
  ]);
  const entries = [
    { name: 'README.txt', data: readme(e, files, generatedAt) },
    { name: 'event.json', data: JSON.stringify(e, null, 2) },
    { name: 'participants.csv', data: toCsv(people.columns, people.rows) },
    { name: 'teams.csv', data: teams },
    { name: 'submissions.csv', data: subs },
    { name: 'scores.csv', data: scores },
    { name: 'results.csv', data: res },
    { name: 'certificates.csv', data: certs },
    { name: 'announcements.csv', data: anns },
    { name: 'help-requests.csv', data: help },
    { name: 'feedback.csv', data: fb.feedback },
    { name: 'nps.csv', data: fb.nps },
    { name: 'votes.csv', data: votes },
    ...files.taken,
  ].map((x) => ({ date: generatedAt, ...x, data: Buffer.isBuffer(x.data) ? x.data : Buffer.from(String(x.data), 'utf8') }));
  const slug = String(e.slug || e.event_code || `event-${e.id}`).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60);
  return { name: `${slug}-${generatedAt.toISOString().slice(0, 10)}.zip`, data: zip(entries), files: files.taken.length, skipped: files.skipped.length };
}

module.exports = { ARCHIVE_AFTER_DAYS, archive, unarchive, autoArchive, isArchived, exportZip };
