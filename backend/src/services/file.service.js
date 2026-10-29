/**
 * @file file.service.js
 * @description Uploaded files: logos, banners, sponsor logos, certificate
 * signatures, registration attachments (CVs, answers to file questions),
 * project files, an event's gallery photos and the photos of the platform's
 * stories from past hackathons.
 *
 * What a file is is decided from its first bytes, never from the name or the
 * header the browser sent, and only the kinds a purpose allows are kept.
 * Bytes are stored in Postgres (file_blobs) behind a `storage` column, so a
 * move to object storage later swaps this module's two storage functions and
 * nothing else. Two ceilings protect the database: the organisation's plan
 * storage, and STORAGE_DB_MAX_MB for everything stored in the database.
 *
 * Public purposes (logos, banners, sponsor logos, gallery and story photos)
 * are readable by anyone who has the id — a random UUID — because they appear
 * on public pages or are handed out by link. The rest
 * is readable only by the uploader, the event's organisers and the platform
 * owner — and project files also by the team, the event's judges and mentors
 * (file.controller.js).
 */

const crypto = require('crypto');
const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');

const MB = 1024 * 1024;

const PURPOSES = Object.freeze({
  event_logo: { public: true, maxBytes: 1 * MB, kinds: ['png', 'jpeg', 'webp'] },
  event_banner: { public: true, maxBytes: 3 * MB, kinds: ['png', 'jpeg', 'webp'] },
  sponsor_logo: { public: true, maxBytes: 1 * MB, kinds: ['png', 'jpeg', 'webp'] },
  // Drawn onto certificate PDFs, which take PNG and JPEG only.
  signature: { public: false, maxBytes: 1 * MB, kinds: ['png', 'jpeg'] },
  registration: { public: false, maxBytes: 5 * MB, kinds: ['pdf', 'docx', 'png', 'jpeg'] },
  // The ceiling for project files; each event narrows size and kinds (builder → Submissions).
  submission: { public: false, maxBytes: 10 * MB, kinds: ['pdf', 'pptx', 'docx', 'zip', 'png', 'jpeg', 'webp'] },
  // Photos from an event, for its people (gallery.service.js).
  gallery: { public: true, maxBytes: 5 * MB, kinds: ['png', 'jpeg', 'webp'] },
  // Photos of the platform's stories (showcase.service.js): no event, no organisation.
  showcase: { public: true, maxBytes: 5 * MB, kinds: ['png', 'jpeg', 'webp'] },
});

/** The builder's file types (submission_config.files.types) as sniffed kinds. */
const SUBMISSION_KINDS = Object.freeze({
  pdf: ['pdf'], pptx: ['pptx'], docx: ['docx'], zip: ['zip'], image: ['png', 'jpeg', 'webp'],
});

const MIME = Object.freeze({
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
});

/** The largest upload any purpose accepts — the body parser's limit. */
const MAX_UPLOAD_BYTES = Math.max(...Object.values(PURPOSES).map((p) => p.maxBytes));

/** Recognise a file by its signature. Returns a kind from MIME, or null. */
function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    // Office documents are zip archives; the entry names say which.
    const names = buf.toString('latin1');
    if (names.includes('word/document.xml') || names.includes('word/')) return 'docx';
    if (names.includes('ppt/presentation.xml') || names.includes('ppt/')) return 'pptx';
    // Spreadsheets and other Office files are not offered anywhere.
    if (names.includes('[Content_Types].xml') || names.includes('xl/')) return null;
    return 'zip';
  }
  // An empty zip archive (end-of-central-directory record only).
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x05 && buf[3] === 0x06) return 'zip';
  return null;
}

/** A name safe to store and to put in a Content-Disposition header. */
function cleanName(raw, kind) {
  let name = '';
  try { name = decodeURIComponent(String(raw || '')); } catch { name = String(raw || ''); }
  name = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>]/g, '').trim();
  if (!name) name = 'file';
  const ext = kind === 'jpeg' ? 'jpg' : kind;
  if (!new RegExp(`\\.${ext}$`, 'i').test(name)) name = `${name.replace(/\.[a-z0-9]{1,5}$/i, '')}.${ext}`;
  return name.slice(-120);
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

function dbCapBytes() {
  const raw = Number(process.env.STORAGE_DB_MAX_MB);
  return (Number.isFinite(raw) && raw > 0 ? raw : 300) * MB;
}

/**
 * Store one upload.
 * @param {object} p
 * @param {Buffer} p.data
 * @param {string} p.purpose
 * @param {object|null} p.event   { id, customer_id }; null for the platform's own files
 * @param {number|null} p.userId  uploader, when signed in
 * @param {string} [p.filename]
 * @param {number|null} [p.storageLimitGb] the plan's storage (null = no limit)
 * @param {{ maxBytes?: number, kinds?: string[] }} [p.limits] narrower rules
 *   for this upload (an event's own size and file types); never wider than
 *   the purpose's.
 */
async function store({ data, purpose, event, userId = null, filename, storageLimitGb = null, limits = null }) {
  const base = PURPOSES[purpose];
  if (!base) throw httpError(400, 'Unknown upload purpose.', 'VALIDATION_ERROR');
  const rule = {
    ...base,
    maxBytes: limits?.maxBytes ? Math.min(base.maxBytes, limits.maxBytes) : base.maxBytes,
    kinds: limits?.kinds ? base.kinds.filter((k) => limits.kinds.includes(k)) : base.kinds,
  };
  if (!Buffer.isBuffer(data) || data.length === 0) throw httpError(400, 'The file is empty.', 'EMPTY_FILE');
  if (data.length > rule.maxBytes) {
    throw httpError(413, `This file is larger than ${Math.round(rule.maxBytes / MB)} MB.`, 'FILE_TOO_LARGE', { maxBytes: rule.maxBytes });
  }
  const kind = sniff(data);
  if (!kind || !rule.kinds.includes(kind)) {
    throw httpError(415, `Allowed file types: ${rule.kinds.join(', ')}.`, 'FILE_TYPE_NOT_ALLOWED', { allowed: rule.kinds });
  }

  const customerId = event?.customer_id || null;
  const totals = await db.query(
    `SELECT COALESCE(SUM(size_bytes), 0)::bigint AS everything,
            COALESCE(SUM(size_bytes) FILTER (WHERE $1::int IS NOT NULL AND customer_id = $1), 0)::bigint AS organisation
       FROM files`,
    [customerId],
  );
  if (Number(totals.rows[0].everything) + data.length > dbCapBytes()) {
    console.error('[files] database storage ceiling reached (STORAGE_DB_MAX_MB)');
    throw httpError(507, 'File storage is full. Please contact HackOS support.', 'STORAGE_FULL');
  }
  if (storageLimitGb != null && Number(totals.rows[0].organisation) + data.length > storageLimitGb * 1024 * MB) {
    throw httpError(507, `Your plan includes ${storageLimitGb} GB of files and it is used up.`, 'PLAN_STORAGE_FULL');
  }

  const id = crypto.randomUUID();
  const claimToken = purpose === 'registration' ? crypto.randomBytes(24).toString('base64url') : null;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO files (id, customer_id, event_id, owner_user_id, purpose, filename, mime, size_bytes,
                          sha256, is_public, claim_token_hash, claimed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id, customerId, event ? event.id : null, userId, purpose, cleanName(filename, kind), MIME[kind], data.length,
        sha256(data), rule.public, claimToken ? sha256(claimToken) : null,
        purpose === 'registration' ? null : new Date(),
      ],
    );
    await client.query('INSERT INTO file_blobs (file_id, data) VALUES ($1, $2)', [id, data]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return {
    id,
    purpose,
    filename: cleanName(filename, kind),
    mime: MIME[kind],
    size: data.length,
    isPublic: rule.public,
    ...(claimToken ? { claimToken } : {}),
  };
}

async function getMeta(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const r = await db.query('SELECT * FROM files WHERE id = $1', [String(id).toLowerCase()]);
  return r.rows[0] || null;
}

async function readBytes(id) {
  const r = await db.query('SELECT data FROM file_blobs WHERE file_id = $1', [id]);
  return r.rows[0]?.data || null;
}

/**
 * A registration upload, checked against the token handed out with it, for
 * use in an answer. Throws when it does not belong to this event or the
 * token does not match; marks it claimed by `userId` inside `client`.
 */
async function claimForRegistration(client, { fileId, claimToken, eventId, userId }) {
  const r = await client.query(
    `SELECT id, event_id, purpose, claim_token_hash, claimed_at, owner_user_id
       FROM files WHERE id = $1 FOR UPDATE`,
    [String(fileId || '').toLowerCase()],
  );
  const f = r.rows[0];
  const tokenOk = f && f.claim_token_hash && claimToken
    && crypto.timingSafeEqual(Buffer.from(f.claim_token_hash), Buffer.from(sha256(String(claimToken))));
  if (!f || f.purpose !== 'registration' || Number(f.event_id) !== Number(eventId) || !tokenOk) {
    throw httpError(400, 'An attached file could not be found. Please upload it again.', 'FILE_NOT_FOUND');
  }
  if (f.claimed_at && Number(f.owner_user_id) !== Number(userId)) {
    throw httpError(400, 'An attached file could not be found. Please upload it again.', 'FILE_NOT_FOUND');
  }
  await client.query(
    'UPDATE files SET claimed_at = COALESCE(claimed_at, now()), owner_user_id = $2 WHERE id = $1',
    [f.id, userId],
  );
  return f.id;
}

async function remove(id) {
  await db.query('DELETE FROM files WHERE id = $1', [id]);
}

/**
 * Uploads that never became part of anything, a day later: registration
 * attachments nobody submitted, project files no submission kept, photos
 * never added to a gallery or a story.
 */
async function purgeUnclaimed() {
  const r = await db.query(
    `DELETE FROM files f
      WHERE f.created_at < now() - interval '24 hours'
        AND ((f.purpose = 'registration' AND f.claimed_at IS NULL)
          OR (f.purpose = 'submission'
              AND NOT EXISTS (SELECT 1 FROM submission_files sf WHERE sf.file_id = f.id))
          OR (f.purpose = 'gallery'
              AND NOT EXISTS (SELECT 1 FROM event_gallery_photos g WHERE g.file_id = f.id))
          OR (f.purpose = 'showcase'
              AND NOT EXISTS (SELECT 1 FROM showcase_posts p
                               WHERE p.cover_file_id = f.id
                                  OR p.photos @> jsonb_build_array(jsonb_build_object('fileId', f.id::text)))))`,
  );
  return r.rowCount;
}

/** Path the API serves a file at; the web app prefixes the API origin. */
const fileUrl = (id) => (id ? `/api/files/${id}` : null);

module.exports = {
  PURPOSES,
  SUBMISSION_KINDS,
  MAX_UPLOAD_BYTES,
  sniff,
  cleanName,
  store,
  getMeta,
  readBytes,
  claimForRegistration,
  remove,
  purgeUnclaimed,
  fileUrl,
};
