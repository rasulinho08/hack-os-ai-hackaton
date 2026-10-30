/**
 * @file telegramLink.service.js
 * @description Connecting people and event channels to the platform's bot,
 * and what the bot does with the updates Telegram sends it.
 *
 * A person connects from their profile: the app asks for a one-time code
 * and opens t.me/<bot>?start=<code>; pressing Start sends "/start <code>" to
 * the bot, which ties that chat to the account. "/stop" undoes it.
 *
 * An organiser connects their event's channel in one of two ways:
 *   - code: add the bot as an administrator and post "/link <code>" in the
 *     channel (posting there proves they run it);
 *   - @name of a public channel: the bot must be an administrator there and
 *     the organiser's own connected Telegram account must be its creator or
 *     an administrator — the bot being present proves nothing about who is
 *     asking, since one bot serves every organisation.
 * Posts the organiser writes in the channel themselves are copied into the
 * event's announcements (switchable per channel).
 *
 * Codes are stored hashed, work once, and expire (15 min for a person,
 * 30 for a channel).
 */

const crypto = require('crypto');
const db = require('../config/db');
const telegram = require('./telegram.service');
const { createAnnouncement } = require('./announcement.service');
const { httpError } = require('../utils/responseFormat');

const CODE_TTL_MIN = { user: 15, channel: 30 };
const CODE_RE = /^[A-Za-z0-9_-]{16,64}$/;

const hash = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');
const newCode = () => crypto.randomBytes(18).toString('base64url');

const WORDS = {
  en: {
    welcome: 'Hi! I am the HackOS bot. To get your events’ announcements here, open HackOS → Profile → Telegram → Connect.',
    linked: '✅ Connected{name}. Announcements of your HackOS events will arrive here. Send /stop to disconnect.',
    code_invalid: 'This link has expired or was already used. Open HackOS → Profile → Telegram and connect again.',
    stopped: 'Disconnected. HackOS announcements will no longer arrive here.',
    not_linked: 'This chat is not connected to a HackOS account.',
    channel_linked: '✅ This channel is connected to “{event}” on HackOS. Its announcements will be posted here.',
    channel_test: '✅ Test message from HackOS for “{event}”.',
  },
  az: {
    welcome: 'Salam! Mən HackOS botuyam. Tədbirlərinizin elanlarını burada almaq üçün HackOS → Profil → Telegram → Qoş bölməsini açın.',
    linked: '✅ Qoşuldu{name}. HackOS tədbirlərinizin elanları bura gələcək. Ayırmaq üçün /stop göndərin.',
    code_invalid: 'Bu linkin vaxtı keçib və ya artıq istifadə olunub. HackOS → Profil → Telegram bölməsindən yenidən qoşun.',
    stopped: 'Ayrıldı. HackOS elanları artıq bura gəlməyəcək.',
    not_linked: 'Bu söhbət heç bir HackOS hesabına qoşulmayıb.',
    channel_linked: '✅ Bu kanal HackOS-da “{event}” tədbirinə qoşuldu. Tədbirin elanları burada paylaşılacaq.',
    channel_test: '✅ HackOS-dan “{event}” üçün sınaq mesajı.',
  },
  ru: {
    welcome: 'Привет! Я бот HackOS. Чтобы получать здесь объявления ваших мероприятий, откройте HackOS → Профиль → Telegram → Подключить.',
    linked: '✅ Подключено{name}. Объявления ваших мероприятий HackOS будут приходить сюда. Чтобы отключиться, отправьте /stop.',
    code_invalid: 'Срок действия ссылки истёк или она уже использована. Откройте HackOS → Профиль → Telegram и подключитесь снова.',
    stopped: 'Отключено. Объявления HackOS больше не будут приходить сюда.',
    not_linked: 'Этот чат не подключён к аккаунту HackOS.',
    channel_linked: '✅ Этот канал подключён к «{event}» в HackOS. Объявления мероприятия будут публиковаться здесь.',
    channel_test: '✅ Тестовое сообщение HackOS для «{event}».',
  },
};

function langOf(code) {
  const c = String(code || '').toLowerCase().slice(0, 2);
  return WORDS[c] ? c : 'en';
}

const say = (lang, key, vars = {}) => Object.entries(vars).reduce(
  (s, [k, v]) => s.split(`{${k}}`).join(v),
  (WORDS[lang] || WORDS.en)[key],
);

function requireBot() {
  if (!telegram.isEnabled()) throw httpError(503, 'The Telegram bot is not configured on this server.', 'TELEGRAM_NOT_CONFIGURED');
}

/* ── Codes ─────────────────────────────────────────────────────────────── */

async function issueCode(purpose, userId, eventId = null) {
  // One live code per person and purpose (and event): asking again retires the old one.
  await db.query(
    `DELETE FROM telegram_link_codes
      WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL AND ($3::int IS NULL OR event_id = $3)`,
    [userId, purpose, eventId],
  );
  const code = newCode();
  const r = await db.query(
    `INSERT INTO telegram_link_codes (code_hash, purpose, user_id, event_id, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)
     RETURNING expires_at`,
    [hash(code), purpose, userId, eventId, String(CODE_TTL_MIN[purpose])],
  );
  return { code, expiresAt: r.rows[0].expires_at };
}

async function consumeCode(code, purpose) {
  if (!CODE_RE.test(String(code || ''))) return null;
  const r = await db.query(
    `UPDATE telegram_link_codes SET used_at = now()
      WHERE code_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING *`,
    [hash(code), purpose],
  );
  return r.rows[0] || null;
}

/** "/link <code>" (or "/link@bot <code>"); in a channel also the bare code. */
function channelCodeIn(text, { bareAllowed }) {
  const t = String(text || '').trim();
  const m = t.match(/^\/link(?:@\w+)?\s+([A-Za-z0-9_-]{16,64})\s*$/i);
  if (m) return m[1];
  if (bareAllowed && /^[A-Za-z0-9_-]{24}$/.test(t)) return t;
  return null;
}

/* ── A person's own chat ───────────────────────────────────────────────── */

/** A deep link that connects the caller's Telegram. */
async function createUserLink(userId) {
  requireBot();
  const bot = await telegram.getBot();
  if (!bot?.username) throw httpError(503, 'Telegram did not accept the bot token.', 'TELEGRAM_UNAVAILABLE');
  const { code, expiresAt } = await issueCode('user', userId);
  return { url: `https://t.me/${bot.username}?start=${code}`, botUsername: bot.username, expiresAt };
}

async function getUserLink(userId) {
  const configured = telegram.isEnabled();
  const bot = configured ? await telegram.getBot() : null;
  const r = await db.query(
    'SELECT username, first_name, linked_at, blocked_at FROM telegram_links WHERE user_id = $1',
    [userId],
  );
  const row = r.rows[0];
  return {
    configured,
    botUsername: bot?.username || null,
    linked: Boolean(row),
    username: row?.username || null,
    firstName: row?.first_name || null,
    linkedAt: row?.linked_at || null,
    blocked: Boolean(row?.blocked_at),
  };
}

async function unlinkUser(userId) {
  const r = await db.query('DELETE FROM telegram_links WHERE user_id = $1', [userId]);
  return r.rowCount > 0;
}

/* ── An event's channel ────────────────────────────────────────────────── */

async function upsertChannel(eventId, chat, userId) {
  const r = await db.query(
    `INSERT INTO event_telegram_channels (event_id, chat_id, chat_type, title, username, linked_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (event_id) DO UPDATE
        SET chat_id = EXCLUDED.chat_id, chat_type = EXCLUDED.chat_type, title = EXCLUDED.title,
            username = EXCLUDED.username, linked_by = EXCLUDED.linked_by, linked_at = now(), last_error = NULL
     RETURNING *`,
    [eventId, chat.id, String(chat.type || 'channel').slice(0, 12), chat.title ? String(chat.title).slice(0, 255) : null,
      chat.username ? String(chat.username).slice(0, 64) : null, userId],
  );
  return r.rows[0];
}

async function eventInfo(eventId) {
  const r = await db.query('SELECT id, name, language FROM events WHERE id = $1', [eventId]);
  return r.rows[0] || { id: eventId, name: '', language: 'en' };
}

/** The channel of an event, for its organisers' Messages page. */
async function getChannel(eventId) {
  const configured = telegram.isEnabled();
  const bot = configured ? await telegram.getBot() : null;
  const r = await db.query(
    `SELECT c.chat_id, c.chat_type, c.title, c.username, c.linked_at, c.mirror_posts, c.last_post_at, c.last_error,
            u.full_name AS linked_by_name
       FROM event_telegram_channels c LEFT JOIN users u ON u.id = c.linked_by
      WHERE c.event_id = $1`,
    [eventId],
  );
  const c = r.rows[0];
  return {
    configured,
    botUsername: bot?.username || null,
    linked: Boolean(c),
    channel: c ? {
      title: c.title,
      username: c.username,
      type: c.chat_type,
      linkedAt: c.linked_at,
      linkedBy: c.linked_by_name || null,
      mirrorPosts: c.mirror_posts,
      lastPostAt: c.last_post_at,
      lastError: c.last_error,
    } : null,
  };
}

/** A code the organiser posts in the channel ("/link <code>"). */
async function createChannelCode(eventId, userId) {
  requireBot();
  const bot = await telegram.getBot();
  if (!bot?.username) throw httpError(503, 'Telegram did not accept the bot token.', 'TELEGRAM_UNAVAILABLE');
  const { code, expiresAt } = await issueCode('channel', userId, eventId);
  return { code, command: `/link ${code}`, botUsername: bot.username, expiresAt };
}

const ADMIN_STATES = new Set(['administrator', 'creator']);

/** Connect a public channel by its @name (see the file comment for the checks). */
async function linkChannelByUsername(eventId, userId, rawName) {
  requireBot();
  const name = telegram.normalizeChatId(rawName);
  if (!/^@[A-Za-z0-9_]{4,32}$/.test(name)) {
    throw httpError(400, 'Enter the channel as @name or a t.me link.', 'TG_BAD_USERNAME');
  }
  const chat = await telegram.call('getChat', { chat_id: name });
  if (!chat.ok) throw httpError(404, 'Telegram has no public channel with this name.', 'TG_CHAT_NOT_FOUND');
  if (!['channel', 'supergroup', 'group'].includes(chat.result.type)) {
    throw httpError(400, 'This is not a channel or group.', 'TG_NOT_CHANNEL');
  }
  const bot = await telegram.getBot();
  const botMember = bot ? await telegram.call('getChatMember', { chat_id: chat.result.id, user_id: bot.id }) : { ok: false };
  if (!botMember.ok || !ADMIN_STATES.has(botMember.result.status)
      || (chat.result.type === 'channel' && botMember.result.can_post_messages === false)) {
    throw httpError(409, `Add @${bot?.username || 'the bot'} to the channel as an administrator who can post, then try again.`, 'TG_BOT_NOT_ADMIN');
  }
  const own = await db.query('SELECT chat_id FROM telegram_links WHERE user_id = $1', [userId]);
  if (!own.rows[0]) {
    throw httpError(409, 'Connect your own Telegram in your profile first, so we can check that you run this channel — or link it with a code instead.', 'TG_OWNER_NOT_LINKED');
  }
  const owner = await telegram.call('getChatMember', { chat_id: chat.result.id, user_id: Number(own.rows[0].chat_id) });
  if (!owner.ok || !ADMIN_STATES.has(owner.result.status)) {
    throw httpError(403, 'Your Telegram account is not an administrator of this channel.', 'TG_NOT_CHANNEL_ADMIN');
  }
  await upsertChannel(eventId, chat.result, userId);
  const e = await eventInfo(eventId);
  await telegram.sendMessage(chat.result.id, telegram.escapeHtml(say(e.language, 'channel_linked', { event: e.name })));
  return getChannel(eventId);
}

async function unlinkChannel(eventId) {
  const r = await db.query('DELETE FROM event_telegram_channels WHERE event_id = $1', [eventId]);
  return r.rowCount > 0;
}

async function setMirror(eventId, on) {
  await db.query('UPDATE event_telegram_channels SET mirror_posts = $2 WHERE event_id = $1', [eventId, Boolean(on)]);
  return getChannel(eventId);
}

/** Post a test message in the event's channel; answers what Telegram said. */
async function testChannel(eventId) {
  requireBot();
  const r = await db.query('SELECT chat_id FROM event_telegram_channels WHERE event_id = $1', [eventId]);
  if (!r.rows[0]) throw httpError(404, 'No Telegram channel is connected to this event.', 'TG_NO_CHANNEL');
  const e = await eventInfo(eventId);
  const sent = await telegram.sendMessage(String(r.rows[0].chat_id), telegram.escapeHtml(say(e.language, 'channel_test', { event: e.name })));
  await db.query(
    'UPDATE event_telegram_channels SET last_error = $2, last_post_at = CASE WHEN $3 THEN now() ELSE last_post_at END WHERE event_id = $1',
    [eventId, sent.ok ? null : sent.description, sent.ok],
  );
  if (!sent.ok) throw httpError(502, `Telegram refused the message: ${sent.description}`, 'TG_SEND_FAILED');
  return getChannel(eventId);
}

/* ── Updates from Telegram (the webhook) ───────────────────────────────── */

const reply = (chatId, text) => telegram.sendMessage(chatId, telegram.escapeHtml(text));

async function linkUserFromStart(code, msg) {
  const lang = langOf(msg.from?.language_code);
  const row = await consumeCode(code, 'user');
  if (!row) {
    await reply(msg.chat.id, say(lang, 'code_invalid'));
    return { result: 'code-invalid' };
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // One chat, one account: connecting moves the chat away from any other account.
    await client.query('DELETE FROM telegram_links WHERE chat_id = $1 AND user_id <> $2', [msg.chat.id, row.user_id]);
    await client.query(
      `INSERT INTO telegram_links (user_id, chat_id, username, first_name, language)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
          SET chat_id = EXCLUDED.chat_id, username = EXCLUDED.username, first_name = EXCLUDED.first_name,
              language = EXCLUDED.language, blocked_at = NULL, linked_at = now()`,
      [row.user_id, msg.chat.id, msg.from?.username ? String(msg.from.username).slice(0, 64) : null,
        msg.from?.first_name ? String(msg.from.first_name).slice(0, 128) : null, lang],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const u = await db.query('SELECT full_name FROM users WHERE id = $1', [row.user_id]);
  const name = u.rows[0]?.full_name ? `: ${u.rows[0].full_name}` : '';
  await reply(msg.chat.id, say(lang, 'linked', { name }));
  return { result: 'user-linked', userId: row.user_id };
}

async function linkChannelFromCode(code, chat, message) {
  const row = await consumeCode(code, 'channel');
  if (!row) return null;
  await upsertChannel(row.event_id, chat, row.user_id);
  // The code has done its job; take it off the channel.
  if (message?.message_id) await telegram.call('deleteMessage', { chat_id: chat.id, message_id: message.message_id });
  const e = await eventInfo(row.event_id);
  await reply(chat.id, say(e.language, 'channel_linked', { event: e.name }));
  return { result: 'channel-linked', eventId: row.event_id };
}

async function onPrivateMessage(msg) {
  const text = String(msg.text || '').trim();
  const lang = langOf(msg.from?.language_code);
  const start = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/i);
  if (start) {
    if (start[1]) return linkUserFromStart(start[1], msg);
    await reply(msg.chat.id, say(lang, 'welcome'));
    return { result: 'welcome' };
  }
  if (/^\/stop\b/i.test(text)) {
    const r = await db.query('DELETE FROM telegram_links WHERE chat_id = $1', [msg.chat.id]);
    await reply(msg.chat.id, say(lang, r.rowCount ? 'stopped' : 'not_linked'));
    return { result: r.rowCount ? 'user-unlinked' : 'not-linked' };
  }
  await reply(msg.chat.id, say(lang, 'welcome'));
  return { result: 'welcome' };
}

/** A post the organiser wrote in a connected channel becomes (or updates) an announcement. */
async function mirrorPost(post, { edited }) {
  const text = String(post.text || post.caption || '').trim();
  if (!text) return { skipped: 'empty' };
  const linked = await db.query(
    `SELECT c.event_id, c.mirror_posts
       FROM event_telegram_channels c JOIN events e ON e.id = c.event_id
      WHERE c.chat_id = $1 AND LOWER(TRIM(COALESCE(e.status::text, ''))) <> 'archived'
      ORDER BY c.linked_at DESC LIMIT 1`,
    [post.chat.id],
  );
  const ch = linked.rows[0];
  if (!ch) return { skipped: 'not-linked' };
  if (!ch.mirror_posts) return { skipped: 'mirror-off' };
  const bot = await telegram.getBot();
  if (bot && (post.from?.id === bot.id || post.via_bot?.id === bot.id)) return { skipped: 'own-post' };
  const ours = await db.query(
    `SELECT 1 FROM announcement_deliveries d JOIN announcements a ON a.id = d.announcement_id
      WHERE a.event_id = $1 AND d.channel = 'telegram_channel' AND d.external_id = $2 LIMIT 1`,
    [ch.event_id, String(post.message_id)],
  );
  if (ours.rows[0]) return { skipped: 'own-post' };

  const ref = `${post.chat.id}:${post.message_id}`.slice(0, 64);
  const [first, ...rest] = text.split('\n');
  const title = first.trim().slice(0, 200) || 'Telegram';
  const content = rest.join('\n').trim() || title;
  if (edited) {
    const r = await db.query(
      `UPDATE announcements SET title = $3, content = $4, updated_at = now()
        WHERE event_id = $1 AND external_ref = $2 AND source = 'telegram' RETURNING id`,
      [ch.event_id, ref, title, content],
    );
    return r.rows[0] ? { result: 'mirror-updated', announcementId: r.rows[0].id } : { skipped: 'unknown-post' };
  }
  const seen = await db.query('SELECT id FROM announcements WHERE event_id = $1 AND external_ref = $2', [ch.event_id, ref]);
  if (seen.rows[0]) return { skipped: 'duplicate' };
  const a = await createAnnouncement({
    event_id: ch.event_id, author_id: null, title, content, type: 'info', priority: 'normal',
    audience: 'everyone', channels: ['platform'], source: 'telegram', external_ref: ref,
  });
  return { result: 'mirrored', announcementId: a.id };
}

async function onMyChatMember(u) {
  const status = u.new_chat_member?.status;
  if (u.chat?.type === 'private') {
    if (status === 'kicked') await db.query('UPDATE telegram_links SET blocked_at = now() WHERE chat_id = $1', [u.chat.id]);
    if (status === 'member') await db.query('UPDATE telegram_links SET blocked_at = NULL WHERE chat_id = $1', [u.chat.id]);
    return { result: `private-${status}` };
  }
  if (status === 'left' || status === 'kicked') {
    await db.query("UPDATE event_telegram_channels SET last_error = 'The bot was removed from this channel' WHERE chat_id = $1", [u.chat.id]);
  } else if (ADMIN_STATES.has(status)) {
    await db.query('UPDATE event_telegram_channels SET last_error = NULL WHERE chat_id = $1', [u.chat.id]);
  }
  return { result: `chat-${status}` };
}

/**
 * Handle one update from the webhook. Never throws for a bad update; the
 * caller still answers Telegram 200 so it does not resend forever.
 */
async function handleUpdate(update) {
  if (!update || !Number.isSafeInteger(update.update_id)) return { skipped: 'invalid' };
  const fresh = await db.query(
    'INSERT INTO telegram_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING update_id',
    [update.update_id],
  );
  if (!fresh.rows[0]) return { skipped: 'duplicate' };

  const msg = update.message;
  if (msg?.chat) {
    if (msg.migrate_to_chat_id) {
      await db.query('UPDATE event_telegram_channels SET chat_id = $2 WHERE chat_id = $1', [msg.chat.id, msg.migrate_to_chat_id]);
      return { result: 'migrated' };
    }
    if (msg.chat.type === 'private') return onPrivateMessage(msg);
    const code = channelCodeIn(msg.text, { bareAllowed: false });
    if (code) return (await linkChannelFromCode(code, msg.chat, msg)) || { skipped: 'code-invalid' };
    return { skipped: 'group-message' };
  }
  const post = update.channel_post || update.edited_channel_post;
  if (post?.chat) {
    if (update.channel_post) {
      const code = channelCodeIn(post.text, { bareAllowed: true });
      if (code) {
        const linked = await linkChannelFromCode(code, post.chat, post);
        if (linked) return linked;
      }
    }
    return mirrorPost(post, { edited: Boolean(update.edited_channel_post) });
  }
  if (update.my_chat_member?.chat) return onMyChatMember(update.my_chat_member);
  return { skipped: 'type' };
}

/**
 * Point Telegram at this server's webhook when TELEGRAM_WEBHOOK_URL is set
 * (with the bot token and TELEGRAM_WEBHOOK_SECRET). Run at boot; harmless to
 * repeat.
 */
async function ensureWebhook() {
  const url = String(process.env.TELEGRAM_WEBHOOK_URL || '').trim();
  if (!url || !telegram.isEnabled() || !telegram.webhookSecret()) return { skipped: true };
  const r = await telegram.call('setWebhook', {
    url,
    secret_token: telegram.webhookSecret(),
    allowed_updates: ['message', 'channel_post', 'edited_channel_post', 'my_chat_member'],
  });
  if (r.ok) console.log('[telegram] webhook set');
  else console.error(`[telegram] could not set the webhook: ${r.description}`);
  return r;
}

/** Housekeeping: old update ids and spent codes. */
async function prune() {
  await db.query("DELETE FROM telegram_updates WHERE received_at < now() - interval '7 days'");
  await db.query("DELETE FROM telegram_link_codes WHERE expires_at < now() - interval '1 day'");
}

module.exports = {
  createUserLink,
  getUserLink,
  unlinkUser,
  getChannel,
  createChannelCode,
  linkChannelByUsername,
  unlinkChannel,
  setMirror,
  testChannel,
  handleUpdate,
  ensureWebhook,
  prune,
  langOf,
};
