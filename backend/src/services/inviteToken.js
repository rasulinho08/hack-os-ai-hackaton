/**
 * @file inviteToken.js
 * @description The token in an event invitation's link.
 *
 * Knowing an invited address and the event code (it is on the public page)
 * is not enough to take the invitation: the role goes to whoever proves they
 * read the address (see emailVerification.service) or who holds the
 * invitation's own link. The link carries this token:
 *
 *   <via>.<inviteId>.<mac>     via: m = sent by e-mail, l = copied by the organiser
 *
 * The mac is an HMAC over the via, the invitation and its address, so the
 * token is the same every time the invitation is sent, needs no storage and
 * dies with the invitation (deleted, or used). A token that came by e-mail
 * also proves the address; a copied link only proves the organiser handed it
 * over, so it opens that one invitation and nothing else.
 *
 * A participant invitation (the organiser's Invitations screen) also signs
 * its row's `token_nonce`. Withdrawing the invitation changes the nonce, so
 * every link sent before stops working at once, even if the same address is
 * invited again later. Invitations without a nonce (staff invitations, and
 * those made before it existed) sign as they always did. Whether an
 * invitation is still live (not used, withdrawn or expired) is the caller's
 * check: the token only says which row it belongs to.
 */

const crypto = require('crypto');

const VIA = { mail: 'm', link: 'l' };
const FROM_CODE = { m: 'mail', l: 'link' };

function key() {
  const secret = process.env.INVITE_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return crypto.createHmac('sha256', String(secret)).update('hackos:event-invite:v1').digest();
}

const macOf = (code, inviteId, email, nonce) =>
  crypto.createHmac('sha256', key())
    .update(`${code}.${inviteId}:${String(email || '').trim().toLowerCase()}${nonce ? `:${nonce}` : ''}`)
    .digest('base64url')
    .slice(0, 32);

/** A fresh nonce for an invitation row (see above). */
const newNonce = () => crypto.randomBytes(12).toString('base64url');

/** The token for an invitation row ({ id, email, token_nonce? }), for the e-mail or for a copied link. */
function sign(invite, via = 'mail') {
  const code = VIA[via];
  if (!code) throw new Error(`Unknown invite token kind: ${via}`);
  return `${code}.${invite.id}.${macOf(code, invite.id, invite.email, invite.token_nonce)}`;
}

/** { via, inviteId } of a well-formed token, or null. Says nothing about validity. */
function parse(token) {
  const m = /^([ml])\.(\d{1,12})\.([A-Za-z0-9_-]{32})$/.exec(String(token || '').trim());
  if (!m) return null;
  return { via: FROM_CODE[m[1]], inviteId: Number(m[2]), mac: m[3] };
}

/** 'mail' or 'link' when the token belongs to this invitation row, else null. */
function check(token, invite) {
  const t = parse(token);
  if (!t || !invite || t.inviteId !== Number(invite.id)) return null;
  const expected = Buffer.from(macOf(VIA[t.via], invite.id, invite.email, invite.token_nonce));
  const given = Buffer.from(t.mac);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return t.via;
}

module.exports = { sign, parse, check, newNonce };
