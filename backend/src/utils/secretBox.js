/**
 * @file secretBox.js
 * @description Encryption of values the database should not hold in the
 * clear (AES-256-GCM, key in the environment).
 *
 *   DATA_ENCRYPTION_KEY           the key new values are sealed with:
 *                                 32 bytes as base64 or hex
 *                                 (`openssl rand -base64 32`)
 *   DATA_ENCRYPTION_KEY_PREVIOUS  older keys, comma separated, still opened
 *                                 (rotation: move the old key here, set a new one)
 *
 * A sealed value reads `enc:v1:<key id>:<iv>:<tag>:<ciphertext>` (base64url),
 * so it stays a string in its column and old plaintext values keep working:
 * `open` returns anything without the prefix as it is. Without a key nothing
 * is sealed (development, or an installation that has not set one yet).
 * A value whose key is gone opens as null, never as the ciphertext.
 *
 * Used for: an event's online room link (it often carries the passcode).
 */

const crypto = require('crypto');

const PREFIX = 'enc:v1:';
let warned = false;

/** A 32-byte key from base64 or hex; anything else is refused loudly. */
function parseKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let buf = null;
  if (/^[0-9a-f]{64}$/i.test(s)) buf = Buffer.from(s, 'hex');
  else {
    try { buf = Buffer.from(s, 'base64'); } catch { buf = null; }
  }
  if (!buf || buf.length !== 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, as base64 or hex (openssl rand -base64 32)');
  }
  return buf;
}

const kidOf = (key) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);

function keys() {
  const current = parseKey(process.env.DATA_ENCRYPTION_KEY);
  const previous = String(process.env.DATA_ENCRYPTION_KEY_PREVIOUS || '')
    .split(',').map((k) => k.trim()).filter(Boolean).map(parseKey);
  const all = new Map();
  for (const k of [current, ...previous].filter(Boolean)) all.set(kidOf(k), k);
  return { current, all };
}

const isEnabled = () => Boolean(keys().current);
const isSealed = (value) => typeof value === 'string' && value.startsWith(PREFIX);

/** The value sealed with the current key; unchanged when there is no key, or for null and ''. */
function seal(value) {
  if (value == null || value === '') return value;
  const { current } = keys();
  if (!current) return value;
  if (isSealed(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', current, iv);
  const ct = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${kidOf(current)}:${iv.toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`;
}

/** The plain value: unsealed values as they are, sealed ones opened, null when they cannot be. */
function open(value) {
  if (!isSealed(value)) return value;
  const [kid, iv, tag, ct] = value.slice(PREFIX.length).split(':');
  const key = keys().all.get(kid);
  if (!key || !iv || !tag || ct == null) {
    if (!warned) {
      warned = true;
      console.error('[secretBox] a sealed value cannot be opened: its key is not in DATA_ENCRYPTION_KEY(_PREVIOUS)');
    }
    return null;
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    if (!warned) {
      warned = true;
      console.error('[secretBox] a sealed value failed its integrity check');
    }
    return null;
  }
}

/** A copy of an events row with its online room link opened. */
function openEvent(row) {
  if (!row || !isSealed(row.online_url)) return row;
  return { ...row, online_url: open(row.online_url) };
}

module.exports = { seal, open, openEvent, isEnabled, isSealed, parseKey };
