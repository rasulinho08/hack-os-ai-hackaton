/**
 * @file telegram.service.js
 * @description The platform's Telegram bot: calls to the Bot API, and how an
 * announcement reads as a Telegram message.
 *
 * One bot serves every organisation (decision F1=a): organisers connect their
 * event's channel to it, participants connect their own chat. The token is
 * the platform's (TELEGRAM_BOT_TOKEN) and never leaves this file — not in a
 * log line, not in an error message.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN        from @BotFather
 *   TELEGRAM_ENABLED          "false" switches the bot off
 *   TELEGRAM_WEBHOOK_SECRET   checked on every webhook call (required for the webhook)
 *   TELEGRAM_API_BASE         another Bot API server (tests use a local fake)
 *
 * `call` never throws: it answers { ok, result } or { ok: false, description,
 * error_code, retryAfter, permanent }, and `permanent` says whether trying
 * again could help (a blocked bot or a deleted chat will not come back).
 */

const DEFAULT_API = 'https://api.telegram.org';
const MAX_TEXT = 4096;
const BOT_INFO_TTL_MS = 3600e3;

let botInfo = null;
let botInfoAt = 0;

const token = () => String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const apiBase = () => String(process.env.TELEGRAM_API_BASE || DEFAULT_API).trim().replace(/\/+$/, '');

function isEnabled() {
  return process.env.TELEGRAM_ENABLED !== 'false' && Boolean(token());
}

/** The webhook secret, or '' when none is set (the webhook then stays shut). */
function webhookSecret() {
  return String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
}

/** Strip the token from anything that might quote a URL back at us. */
function scrub(text) {
  const t = token();
  const s = String(text || '');
  return t ? s.split(t).join('<token>') : s;
}

/*
 * Errors that will not go away by waiting: the person blocked the bot, the
 * bot was removed from the channel, the chat no longer exists, the text is
 * malformed. Rate limits, Telegram's own outages and network trouble are
 * worth another try.
 */
function isPermanent(errorCode, description) {
  if (errorCode === 403) return true;
  if (errorCode === 400) return true;
  return /chat not found|user is deactivated|bot was kicked|bot was blocked|have no rights|not enough rights/i.test(description || '');
}

/**
 * Call a Bot API method.
 * @returns {Promise<{ ok: true, result: any } | { ok: false, error_code: number, description: string,
 *   retryAfter: number|null, permanent: boolean, notConfigured?: true }>}
 */
async function call(method, params = {}, { timeoutMs = 10_000 } = {}) {
  if (!isEnabled()) {
    return { ok: false, error_code: 0, description: 'Telegram is not configured', retryAfter: null, permanent: true, notConfigured: true };
  }
  try {
    const res = await fetch(`${apiBase()}/bot${token()}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => ({}));
    if (body && body.ok) return { ok: true, result: body.result };
    const errorCode = Number(body.error_code || res.status) || 0;
    const description = scrub(body.description || `HTTP ${res.status}`);
    return {
      ok: false,
      error_code: errorCode,
      description,
      retryAfter: body.parameters?.retry_after ?? null,
      permanent: errorCode === 429 ? false : isPermanent(errorCode, description),
    };
  } catch (err) {
    const description = err?.name === 'TimeoutError' ? 'Telegram did not answer in time' : scrub(err?.message || 'network error');
    return { ok: false, error_code: 0, description, retryAfter: null, permanent: false };
  }
}

/** The bot's own id and username (cached for an hour). */
async function getBot() {
  if (botInfo && Date.now() - botInfoAt < BOT_INFO_TTL_MS) return botInfo;
  const r = await call('getMe');
  if (!r.ok) return null;
  botInfo = { id: r.result.id, username: r.result.username };
  botInfoAt = Date.now();
  return botInfo;
}

/** For tests: forget the cached bot identity. */
function resetCache() {
  botInfo = null;
  botInfoAt = 0;
}

function sendMessage(chatId, text, extra = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text: String(text || '').slice(0, MAX_TEXT),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

/**
 * A chat id as the Bot API takes it: a number (-100… for channels) or an
 * @username. Accepts t.me links and bare names, as people paste them.
 */
function normalizeChatId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const tme = s.match(/t\.me\/([a-z0-9_]+)/i);
  if (tme) return `@${tme[1]}`;
  const compact = s.replace(/\s+/g, '');
  if (/^-?\d+$/.test(compact)) return compact;
  return s.startsWith('@') ? s : `@${s}`;
}

const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Telegram refuses buttons that point at localhost or plain http. */
function buttonUrl(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'https:' || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const ICON = { urgent: '🚨', high: '❗', normal: '📢', low: '📢' };
const OPEN_LABEL = { az: 'HackOS-da aç', en: 'Open in HackOS', ru: 'Открыть в HackOS' };

/**
 * An announcement as a Telegram message: bold title, then the text. A
 * personal message names the event (a person may follow several); a channel
 * post does not need to.
 *
 * @returns {{ text: string, extra: object }}
 */
function announcementMessage({ title, content, priority, eventName, withEvent = false, url = null, lang = 'en' }) {
  const head = `${ICON[String(priority || '').toLowerCase()] || ICON.normal} <b>${escapeHtml(title)}</b>`;
  const event = withEvent && eventName ? `\n<i>${escapeHtml(eventName)}</i>` : '';
  const room = MAX_TEXT - head.length - event.length - 4;
  let body = escapeHtml(String(content || '').trim());
  if (body.length > room) body = `${body.slice(0, Math.max(0, room - 1))}…`;
  const text = `${head}${event}\n\n${body}`;
  const link = buttonUrl(url);
  const extra = link
    ? { reply_markup: { inline_keyboard: [[{ text: OPEN_LABEL[lang] || OPEN_LABEL.en, url: link }]] } }
    : {};
  return { text, extra };
}

module.exports = {
  isEnabled,
  webhookSecret,
  call,
  getBot,
  resetCache,
  sendMessage,
  announcementMessage,
  escapeHtml,
  buttonUrl,
  normalizeChatId,
  isPermanent,
};
