/**
 * Base URL for links in outbound emails (invites, approvals).
 * Matches CORS / deploy env naming used across the stack.
 */
function resolveFrontendBaseUrl() {
  const direct = process.env.FRONTEND_URL?.trim();
  if (direct) return direct.replace(/\/+$/, '');
  const list = process.env.FRONTEND_URLS?.trim();
  if (list) {
    const first = list.split(',')[0]?.trim();
    if (first) return first.replace(/\/+$/, '');
  }
  for (const key of ['CLIENT_URL', 'APP_URL', 'SITE_URL', 'NEXT_PUBLIC_APP_URL']) {
    const v = process.env[key]?.trim();
    if (v) return v.replace(/\/+$/, '');
  }
  return 'http://localhost:3000';
}

/**
 * Origins the web app is served from (FRONTEND_URL and FRONTEND_URLS), plus
 * the default base. Used to accept a link's host from the browser — the
 * customer may be on www. or app. — without letting a caller point an e-mail
 * at an arbitrary site.
 */
function allowedFrontendOrigins() {
  const raw = [process.env.FRONTEND_URL, ...(process.env.FRONTEND_URLS || '').split(','), resolveFrontendBaseUrl()];
  const out = new Set();
  for (const v of raw) {
    try {
      if (v && v.trim()) out.add(new URL(v.trim()).origin);
    } catch (_) { /* not a URL: ignore */ }
  }
  return out;
}

/**
 * The base for links in an e-mail: the origin of `candidate` when it is one of
 * the app's own, otherwise the configured default.
 */
function pickFrontendBase(candidate) {
  try {
    const origin = new URL(String(candidate || '')).origin;
    if (allowedFrontendOrigins().has(origin)) return origin;
  } catch (_) { /* fall through */ }
  return resolveFrontendBaseUrl();
}

/**
 * Where the platform itself lives (app.<domain>), for links that lead into it,
 * such as setup links: APP_ORIGIN when set, else the site's base URL (one host
 * in development and on staging).
 */
function resolveAppBaseUrl() {
  const v = process.env.APP_ORIGIN?.trim();
  return v ? v.replace(/\/+$/, '') : resolveFrontendBaseUrl();
}

module.exports = { resolveFrontendBaseUrl, resolveAppBaseUrl, allowedFrontendOrigins, pickFrontendBase };
