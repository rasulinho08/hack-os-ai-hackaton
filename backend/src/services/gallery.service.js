/**
 * @file gallery.service.js
 * @description An event's photo gallery: the organisers put photos up after
 * the event and tell people about them (a message in the general chat, an
 * announcement by e-mail); the event's people look at them.
 *
 * Who sees it: the organisers and the event's people — accepted participants,
 * judges, mentors and volunteers. Anyone else is answered as for an event
 * they cannot reach (404). The plan's 'gallery' module is checked where the
 * routes are mounted (MODULE_DISABLED). The photos are 'gallery' files —
 * images, public by link (a random UUID) — uploaded by the organisers
 * through POST /api/files?purpose=gallery&eventId= and then added here.
 */

const db = require('../config/db');
const { fileUrl } = require('./file.service');
const { eventRoleOf } = require('./effectiveRole.service');
const { forEvent } = require('./entitlement.service');
const announcementService = require('./announcement.service');
const jobs = require('./jobs.service');
const chat = require('./chat.service');
const { resolveFrontendBaseUrl } = require('../utils/frontendUrl');
const { isOwnerUser } = require('../utils/authz');
const { httpError } = require('../utils/responseFormat');

const MAX_PHOTOS = 200;
const MAX_CAPTION = 200;
const MAX_MESSAGE = 500;
/** E-mail announcements an event may send a day (the same cap the composer has). */
const EMAIL_PER_DAY = 20;
const SEES = ['approved', 'eliminated'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const WORDS = {
  az: { title: 'Tədbirdən şəkillər', body: 'Tədbirdən şəkillər hazırdır. Baxmaq üçün linki açın:' },
  en: { title: 'Photos from the event', body: 'The photos from the event are up. Open the link to see them:' },
  ru: { title: 'Фотографии с мероприятия', body: 'Фотографии с мероприятия готовы. Откройте ссылку, чтобы посмотреть:' },
};

const notFound = () => httpError(404, 'Event not found', 'NOT_FOUND');
const invalid = (field, message) => httpError(400, message, 'VALIDATION_ERROR', { errors: [{ field, message }] });
const iso = (t) => (t ? new Date(t).toISOString() : null);

/** { read, manage } for one person in one event. */
async function accessOf(user, eventId) {
  if (!user) return { read: false, manage: false };
  if (isOwnerUser(user)) return { read: true, manage: true };
  const found = await eventRoleOf(user.id, eventId);
  if (!found) return { read: false, manage: false };
  if (found.role === 'organizer') return { read: true, manage: true };
  if (['judge', 'mentor', 'volunteer'].includes(found.role)) return { read: true, manage: false };
  return { read: SEES.includes(String(found.participantStatus || '')), manage: false };
}

async function requireRead(user, eventId) {
  const access = await accessOf(user, eventId);
  if (!access.read) throw notFound();
  return access;
}

async function requireManage(user, eventId) {
  const access = await accessOf(user, eventId);
  if (!access.read) throw notFound();
  if (!access.manage) throw httpError(403, 'Only the organisers manage the photos.', 'FORBIDDEN');
  return access;
}

async function eventRow(eventId) {
  const r = await db.query('SELECT id, slug, name, language, start_date, end_date FROM events WHERE id = $1', [eventId]);
  return r.rows[0] || null;
}

/** GET: the photos and what the caller may do. */
async function view(eventId, access) {
  const [ev, rows, shares, scope] = await Promise.all([
    eventRow(eventId),
    db.query(
      `SELECT id, file_id::text AS file_id, caption, position, created_at
         FROM event_gallery_photos WHERE event_id = $1 ORDER BY position, id`,
      [eventId],
    ),
    db.query('SELECT chat_at, email_at FROM event_gallery_shares WHERE event_id = $1', [eventId]),
    forEvent(eventId),
  ]);
  if (!ev) throw notFound();
  return {
    enabled: !scope || scope.modules.has('gallery'),
    canManage: Boolean(access.manage),
    eventId: ev.id,
    eventSlug: ev.slug || null,
    eventName: ev.name,
    startDate: iso(ev.start_date),
    endDate: iso(ev.end_date),
    maxPhotos: MAX_PHOTOS,
    items: rows.rows.map((r) => ({
      id: r.id,
      fileId: r.file_id,
      url: fileUrl(r.file_id),
      caption: r.caption || null,
      position: r.position,
      createdAt: iso(r.created_at),
    })),
    shared: { chatAt: iso(shares.rows[0]?.chat_at), emailAt: iso(shares.rows[0]?.email_at) },
  };
}

async function get(user, eventId) {
  const access = await requireRead(user, eventId);
  return view(eventId, access);
}

/** The gallery of the event with this public address, for the link people get. */
async function getBySlug(user, slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(s)) throw notFound();
  const ev = (await db.query('SELECT id FROM events WHERE slug = $1', [s])).rows[0];
  if (!ev) throw notFound();
  const access = await requireRead(user, ev.id);
  const scope = await forEvent(ev.id);
  if (scope && !scope.modules.has('gallery') && !isOwnerUser(user)) {
    throw httpError(403, 'This feature is not part of the plan this event runs on.', 'MODULE_DISABLED', { module: 'gallery' });
  }
  return view(ev.id, access);
}

/** POST { fileIds }: this event's gallery uploads, added in the order given. */
async function add(user, eventId, body) {
  const access = await requireManage(user, eventId);
  const raw = body && Array.isArray(body.fileIds) ? body.fileIds : null;
  if (!raw || !raw.length) throw invalid('fileIds', 'Choose the photos to add.');
  if (raw.length > MAX_PHOTOS) throw invalid('fileIds', `At most ${MAX_PHOTOS} photos.`);
  const ids = [...new Set(raw.map((v) => String(v ?? '').trim().toLowerCase()))];
  if (ids.some((id) => !UUID_RE.test(id))) throw invalid('fileIds', 'One of these is not a photo uploaded for this gallery.');
  const found = new Set((await db.query(
    `SELECT id::text AS id FROM files WHERE id = ANY($1::uuid[]) AND purpose = 'gallery' AND event_id = $2`,
    [ids, eventId],
  )).rows.map((r) => r.id));
  if (ids.some((id) => !found.has(id))) throw invalid('fileIds', 'One of these is not a photo uploaded for this gallery.');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // One gallery change at a time per event, so the count below holds.
    await client.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [eventId]);
    const have = (await client.query(
      'SELECT file_id::text AS file_id, position FROM event_gallery_photos WHERE event_id = $1',
      [eventId],
    )).rows;
    const already = new Set(have.map((r) => r.file_id));
    const fresh = ids.filter((id) => !already.has(id));
    if (have.length + fresh.length > MAX_PHOTOS) {
      throw httpError(409, `A gallery holds at most ${MAX_PHOTOS} photos.`, 'GALLERY_FULL', { max: MAX_PHOTOS, have: have.length });
    }
    let next = have.reduce((m, r) => Math.max(m, Number(r.position) || 0), 0) + 1;
    for (const id of fresh) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO event_gallery_photos (event_id, file_id, position, created_by)
         VALUES ($1, $2, $3, $4) ON CONFLICT (event_id, file_id) DO NOTHING`,
        [eventId, id, next, user.id],
      );
      next += 1;
    }
    await client.query('COMMIT');
    const out = await view(eventId, access);
    return { ...out, added: fresh.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function photoOf(eventId, photoId) {
  const id = Number.parseInt(String(photoId), 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return (await db.query(
    'SELECT id, file_id::text AS file_id FROM event_gallery_photos WHERE id = $1 AND event_id = $2',
    [id, eventId],
  )).rows[0] || null;
}

/** PATCH /:photoId { caption?, position? } */
async function update(user, eventId, photoId, body) {
  const access = await requireManage(user, eventId);
  const photo = await photoOf(eventId, photoId);
  if (!photo) throw httpError(404, 'Photo not found', 'NOT_FOUND');
  const b = body && typeof body === 'object' ? body : {};
  const sets = [];
  const params = [photo.id];
  if (b.caption !== undefined) {
    if (b.caption !== null && typeof b.caption !== 'string') throw invalid('caption', 'Must be text.');
    // eslint-disable-next-line no-control-regex
    const caption = String(b.caption ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
    if (caption.length > MAX_CAPTION) throw invalid('caption', `At most ${MAX_CAPTION} characters.`);
    params.push(caption || null);
    sets.push(`caption = $${params.length}`);
  }
  if (b.position !== undefined) {
    const n = Number(b.position);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw invalid('position', 'A whole number, 0 or more.');
    params.push(n);
    sets.push(`position = $${params.length}`);
  }
  if (sets.length) await db.query(`UPDATE event_gallery_photos SET ${sets.join(', ')} WHERE id = $1`, params);
  const out = await view(eventId, access);
  return { ...out, photo: out.items.find((i) => i.id === photo.id) || null };
}

/** DELETE /:photoId — the photo leaves the gallery and its file is removed. */
async function remove(user, eventId, photoId) {
  await requireManage(user, eventId);
  const photo = await photoOf(eventId, photoId);
  if (!photo) throw httpError(404, 'Photo not found', 'NOT_FOUND');
  await db.query("DELETE FROM files WHERE id = $1 AND purpose = 'gallery' AND event_id = $2", [photo.file_id, eventId]);
  await db.query('DELETE FROM event_gallery_photos WHERE id = $1', [photo.id]);
  return { id: photo.id, fileId: photo.file_id };
}

/**
 * POST /share { chat?, email?, message? } — tells the event's people where
 * the photos are: a message in the general chat (when the plan has the chat
 * and the organisers keep the general channel on), and an announcement to
 * the people who took part, in the app and by e-mail.
 */
async function share(user, eventId, body) {
  await requireManage(user, eventId);
  const b = body && typeof body === 'object' ? body : {};
  const wantChat = b.chat === true;
  const wantEmail = b.email === true;
  if (!wantChat && !wantEmail) throw invalid('chat', 'Choose where to share the photos.');
  if (b.message != null && typeof b.message !== 'string') throw invalid('message', 'Must be text.');
  // eslint-disable-next-line no-control-regex
  const message = String(b.message ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (message.length > MAX_MESSAGE) throw invalid('message', `At most ${MAX_MESSAGE} characters.`);

  const ev = await eventRow(eventId);
  if (!ev) throw notFound();
  const count = (await db.query('SELECT COUNT(*)::int AS n FROM event_gallery_photos WHERE event_id = $1', [eventId])).rows[0].n;
  if (!count) throw httpError(409, 'Add some photos before sharing the gallery.', 'GALLERY_EMPTY');
  if (!ev.slug) throw httpError(409, 'The event needs a public address before its gallery can be shared.', 'NO_EVENT_PAGE');

  const words = WORDS[ev.language] || WORDS.en;
  const link = `${resolveFrontendBaseUrl()}/e/${ev.slug}/gallery`;
  const text = message || words.body;
  const out = { chat: null, email: null, link };

  if (wantChat) {
    const settings = await chat.settingsFor(eventId);
    if (!settings.chatModule) out.chat = 'not_in_plan';
    else if (!settings.general) out.chat = 'off';
    else {
      const list = await chat.listChannels(user, eventId);
      const general = list.channels.find((c) => c.kind === 'general');
      if (!general) out.chat = 'off';
      else {
        const posted = await chat.post(user, eventId, general.id, `${text}\n${link}`);
        out.chat = 'sent';
        out.messageId = posted.message.id;
      }
    }
  }

  if (wantEmail) {
    const scope = await forEvent(eventId);
    if (scope && !scope.modules.has('announcements')) out.email = 'not_in_plan';
    else if ((await announcementService.emailAnnouncementsToday(eventId)) >= EMAIL_PER_DAY) out.email = 'limit';
    else {
      const a = await announcementService.createAnnouncement({
        event_id: eventId,
        author_id: user.id,
        title: words.title,
        content: `${text}\n\n${link}`,
        type: 'info',
        priority: 'normal',
        audience: 'attendees',
        channels: announcementService.normaliseChannels(['email']),
      });
      // eslint-disable-next-line global-require
      const { publishKey } = require('../jobs/announcementJobs');
      await jobs.enqueue('announcement.publish', { announcementId: a.id }, { dedupeKey: publishKey(a) });
      out.email = 'queued';
      out.announcementId = a.id;
    }
  }

  if (out.chat === 'sent' || out.email === 'queued') {
    await db.query(
      `INSERT INTO event_gallery_shares (event_id, chat_at, email_at, updated_by)
       VALUES ($1, CASE WHEN $2 THEN now() END, CASE WHEN $3 THEN now() END, $4)
       ON CONFLICT (event_id) DO UPDATE SET
         chat_at = CASE WHEN $2 THEN now() ELSE event_gallery_shares.chat_at END,
         email_at = CASE WHEN $3 THEN now() ELSE event_gallery_shares.email_at END,
         updated_by = $4`,
      [eventId, out.chat === 'sent', out.email === 'queued', user.id],
    );
  }
  return out;
}

module.exports = { MAX_PHOTOS, MAX_CAPTION, MAX_MESSAGE, accessOf, get, getBySlug, add, update, remove, share };
