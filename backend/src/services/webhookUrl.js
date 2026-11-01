/**
 * @file webhookUrl.js
 * @description Where a webhook may be sent: the checks that keep an
 * organisation's endpoint from pointing the API at itself or at the
 * provider's network (SSRF).
 *
 * In production an endpoint must be `https:` and every address its host
 * resolves to must be public: no loopback, private (10/8, 172.16/12,
 * 192.168/16, fc00::/7), carrier-grade NAT (100.64/10), link-local
 * (169.254/16 — the cloud metadata service — and fe80::/10), multicast,
 * reserved or unspecified addresses, including IPv4 written inside IPv6
 * (::ffff:a.b.c.d, 64:ff9b::/96). The host is resolved again on every
 * delivery and the connection goes to the address that was checked (the
 * request's `lookup`), so a name that resolves to something else a second
 * later (DNS rebinding) is refused too. Redirects are never followed.
 *
 * WEBHOOKS_ALLOW_PRIVATE_TARGETS=true allows `http:` and loopback/private
 * addresses — for local development, tests and installations that deliver
 * to their own network. It defaults to true only when NODE_ENV says
 * development or test, and to false otherwise: a server started without
 * NODE_ENV is treated as production. Link-local, multicast and unspecified
 * addresses stay refused either way.
 */

const dns = require('dns');
const net = require('net');
const { isDevLike } = require('../utils/runtimeEnv');

const MAX_URL_LENGTH = 2048;

/** True when http: and private/loopback targets are allowed (see the header). */
function allowPrivateTargets() {
  const raw = String(process.env.WEBHOOKS_ALLOW_PRIVATE_TARGETS || '').trim().toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return isDevLike();
}

function blockList(entries) {
  const list = new net.BlockList();
  for (const [prefix, bits, type] of entries) list.addSubnet(prefix, bits, type);
  return list;
}

/** Never a webhook target, whatever the switch says. */
const ALWAYS_BLOCKED = blockList([
  ['0.0.0.0', 8, 'ipv4'], // "this network", unspecified
  ['169.254.0.0', 16, 'ipv4'], // link-local, cloud metadata (169.254.169.254)
  ['224.0.0.0', 4, 'ipv4'], // multicast
  ['240.0.0.0', 4, 'ipv4'], // reserved, broadcast
  ['::', 128, 'ipv6'], // unspecified
  ['fe80::', 10, 'ipv6'], // link-local
  ['ff00::', 8, 'ipv6'], // multicast
]);

/** Not public: refused unless private targets are allowed. */
const PRIVATE = blockList([
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'], // carrier-grade NAT
  ['127.0.0.0', 8, 'ipv4'], // loopback
  ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'], // IETF protocol assignments
  ['192.0.2.0', 24, 'ipv4'], // documentation
  ['192.88.99.0', 24, 'ipv4'], // 6to4 relay
  ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'], // benchmarking
  ['198.51.100.0', 24, 'ipv4'], // documentation
  ['203.0.113.0', 24, 'ipv4'], // documentation
  ['::1', 128, 'ipv6'], // loopback
  ['fc00::', 7, 'ipv6'], // unique local
  ['100::', 64, 'ipv6'], // discard
  ['64:ff9b:1::', 48, 'ipv6'], // NAT64 for local use
  ['2001:db8::', 32, 'ipv6'], // documentation
  ['2001::', 32, 'ipv6'], // Teredo
  ['2002::', 16, 'ipv6'], // 6to4 (carries an IPv4 inside)
]);

/**
 * The IPv4 address an IPv6 one carries — mapped (::ffff:0:0/96), translated
 * (::ffff:0:0:0/96), compatible (::/96) or NAT64 (64:ff9b::/96) — or null.
 */
function embeddedIPv4(address) {
  const a = String(address).toLowerCase();
  const dotted = /^(?:::ffff:|::ffff:0:|::|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (dotted) return dotted[1];
  const hex = /^(?:::ffff:|::ffff:0:|::|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

const PROBLEMS = Object.freeze({
  blocked_address: 'a link-local, multicast or unspecified address',
  private_address: 'a private or loopback address',
});

/**
 * Why `address` may not receive a webhook — 'blocked_address' or
 * 'private_address' — or null when it may.
 * @param {string} address  an IPv4 or IPv6 literal
 * @param {{ allowPrivate?: boolean }} [opts]
 */
function addressReason(address, { allowPrivate = allowPrivateTargets() } = {}) {
  let raw = String(address || '').replace(/^\[|\]$/g, '').split('%')[0];
  const family = net.isIP(raw);
  if (!family) return 'blocked_address';
  // One spelling per address (0:0:0:0:0:ffff:7f00:1 is ::ffff:7f00:1), so the checks below see it.
  if (family === 6) raw = new URL(`http://[${raw}]/`).hostname.slice(1, -1);
  const inner = family === 6 ? embeddedIPv4(raw) : null;
  if (inner) return addressReason(inner, { allowPrivate });
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (ALWAYS_BLOCKED.check(raw, type)) return 'blocked_address';
  if (!allowPrivate && PRIVATE.check(raw, type)) return 'private_address';
  return null;
}

/** The same in words ("a private or loopback address"), or null. */
function addressProblem(address, opts) {
  const reason = addressReason(address, opts);
  return reason ? PROBLEMS[reason] : null;
}

/** A refusal with its reason (VALIDATION codes the app translates). */
const refusal = (reason, error) => ({ error, reason });

/**
 * The URL as stored, or why it cannot be used: `error` in words and
 * `reason` (required, too_long, invalid, not_https, credentials, no_host,
 * local_name, blocked_address, private_address). Checks the form only;
 * where the host points is checked by `resolveTarget`.
 * @returns {{ url: URL } | { error: string, reason: string }}
 */
function parseTargetUrl(raw, { allowPrivate = allowPrivateTargets() } = {}) {
  const s = String(raw ?? '').trim();
  if (!s) return refusal('required', 'Enter the URL that should receive the webhooks.');
  if (s.length > MAX_URL_LENGTH) return refusal('too_long', `The URL is longer than ${MAX_URL_LENGTH} characters.`);
  let url;
  try {
    url = new URL(s);
  } catch {
    return refusal('invalid', 'This is not a valid URL.');
  }
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) {
    return refusal('not_https', 'The URL must start with https://.');
  }
  if (url.username || url.password) return refusal('credentials', 'Put credentials in the secret, not in the URL.');
  if (!url.hostname) return refusal('no_host', 'The URL has no host.');
  url.hash = '';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    const reason = addressReason(host, { allowPrivate });
    if (reason) return refusal(reason, `Webhooks cannot be sent to ${PROBLEMS[reason]}.`);
  } else if (!allowPrivate && /(^|\.)(localhost|local|internal|localdomain)$/i.test(host)) {
    return refusal('local_name', 'Webhooks cannot be sent to a local host name.');
  }
  return { url };
}

/** An Error with a `reason`, for resolveTarget. */
const refused = (reason, message) => Object.assign(new Error(message), { reason });

/**
 * Every address `hostname` resolves to, each checked. Throws with a message
 * a person can act on when the host does not resolve or any address is refused.
 * @returns {Promise<{ address: string, family: number }[]>}
 */
async function resolveTarget(hostname, { allowPrivate = allowPrivateTargets(), lookup = dns.promises.lookup } = {}) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    const reason = addressReason(host, { allowPrivate });
    if (reason) throw refused(reason, `Webhooks cannot be sent to ${PROBLEMS[reason]}.`);
    return [{ address: host, family: net.isIP(host) }];
  }
  let found;
  try {
    found = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw refused('not_found', `The host ${host} could not be found.`);
  }
  const list = Array.isArray(found) ? found : [found];
  if (!list.length) throw refused('not_found', `The host ${host} could not be found.`);
  for (const a of list) {
    const reason = addressReason(a.address, { allowPrivate });
    if (reason) throw refused(reason, `${host} points to ${PROBLEMS[reason]}; webhooks cannot be sent there.`);
  }
  return list;
}

/**
 * A `lookup` for http(s).request that resolves the host itself, refuses
 * anything not allowed, and connects to the address it checked. (`lookup`
 * replaces the DNS resolver, for tests.)
 */
function safeLookup({ allowPrivate = allowPrivateTargets(), lookup = dns.promises.lookup } = {}) {
  return (hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'object' && options ? options : {};
    resolveTarget(hostname, { allowPrivate, lookup }).then(
      (list) => {
        if (opts.all) return cb(null, list);
        const pick = list.find((a) => !opts.family || a.family === opts.family) || list[0];
        return cb(null, pick.address, pick.family);
      },
      (err) => cb(Object.assign(err, { code: 'WEBHOOK_TARGET_REFUSED' })),
    );
  };
}

module.exports = {
  MAX_URL_LENGTH,
  allowPrivateTargets,
  addressReason,
  addressProblem,
  embeddedIPv4,
  parseTargetUrl,
  resolveTarget,
  safeLookup,
};
