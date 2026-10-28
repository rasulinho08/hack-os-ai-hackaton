/**
 * CORS: whitelist only (no origin: true).
 * Reads several common env names so one typo does not break production.
 */

const DEFAULT_DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

/** Single URL or comma-separated; also scan separate env keys (Render/Vercel/…). */
const ENV_ORIGIN_KEYS = [
  'FRONTEND_ORIGINS',
  'FRONTEND_URLS',
  'FRONTEND_URL',
  'CLIENT_URL',
  'CORS_ORIGIN',
  'PUBLIC_APP_URL',
  'APP_URL',
  'NEXT_PUBLIC_APP_URL',
  'SITE_URL',
  'WEB_URL',
];

/**
 * Normalize to `https://host` or `http://host` with no path/trailing slash (Origin header shape).
 */
function normalizeOriginString(input) {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) {
    s = `https://${s}`;
  }
  try {
    const u = new URL(s);
    if (!u.hostname) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function collectWhitelist() {
  const set = new Set();

  for (const key of ENV_ORIGIN_KEYS) {
    const val = process.env[key];
    if (!val) continue;
    for (const part of val.split(',')) {
      const n = normalizeOriginString(part);
      if (n) set.add(n);
    }
  }

  return [...set];
}

function buildProductionList() {
  const fromEnv = collectWhitelist();
  if (process.env.NODE_ENV === 'production' && fromEnv.length === 0) {
    console.error(
      '[cors] No allowed origins found. Set at least one of: FRONTEND_URL, FRONTEND_ORIGINS, CLIENT_URL, CORS_ORIGIN, APP_URL (comma-separated for multiple). ' +
        'Example: FRONTEND_URL=https://your-app.vercel.app'
    );
  } else if (fromEnv.length > 0) {
    console.info(`[cors] Allowed browser origins (${fromEnv.length}): ${fromEnv.join(', ')}`);
  }
  return fromEnv;
}

let cachedProductionList = null;
function getProductionWhitelist() {
  if (cachedProductionList === null) {
    cachedProductionList = buildProductionList();
  }
  return cachedProductionList;
}

/**
 * Express cors options factory (call once at startup).
 */
function corsOptions() {
  const productionList = getProductionWhitelist();

  const devMerged =
    process.env.NODE_ENV !== 'production'
      ? [...new Set([...productionList, ...DEFAULT_DEV_ORIGINS])]
      : productionList;

  return {
    origin(origin, cb) {
      if (!origin) {
        return cb(null, true);
      }
      const requestOrigin = normalizeOriginString(origin);
      if (!requestOrigin) {
        return cb(null, false);
      }
      const list =
        process.env.NODE_ENV !== 'production' ? devMerged : productionList;
      if (list.length === 0) {
        return cb(null, false);
      }
      return cb(null, list.includes(requestOrigin));
    },
    credentials: true,
  };
}

module.exports = { corsOptions, collectWhitelist, normalizeOriginString };
