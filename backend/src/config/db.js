const { Pool } = require('pg');
require('dotenv').config();

/**
 * TLS towards PostgreSQL.
 *
 * Resolution order:
 *   1. DATABASE_SSL env: disable | require | no-verify
 *   2. ?sslmode=… in DATABASE_URL (disable | require | no-verify / prefer)
 *   3. Local / docker-network hosts (localhost, 127.0.0.1, bare service
 *      names such as "postgres") → no TLS
 *   4. Known managed providers (Supabase, Neon, Render, …) → TLS without
 *      CA verification (their chains trip Node's verifier)
 *   5. Anything else → strict TLS
 */
function getSslOption() {
  const url = process.env.DATABASE_URL || '';

  const fromMode = (mode) => {
    switch (String(mode || '').trim().toLowerCase()) {
      case 'disable': case 'false': case '0': case 'off':
        return false;
      case 'require': case 'true': case '1': case 'verify-full': case 'verify-ca':
        return { rejectUnauthorized: true };
      case 'no-verify': case 'prefer': case 'allow':
        return { rejectUnauthorized: false };
      default:
        return undefined;
    }
  };

  const explicit = fromMode(process.env.DATABASE_SSL);
  if (explicit !== undefined) return explicit;

  let hostname = '';
  let sslmode = '';
  try {
    const u = new URL(url);
    hostname = u.hostname.toLowerCase();
    sslmode = u.searchParams.get('sslmode') || '';
  } catch {
    return { rejectUnauthorized: true };
  }

  const fromUrl = fromMode(sslmode);
  if (fromUrl !== undefined) return fromUrl;

  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    return { rejectUnauthorized: false };
  }
  // Legacy flag kept for compatibility
  const legacy = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
  if (legacy === 'true' || legacy === '1') return { rejectUnauthorized: true };
  if (legacy === 'false' || legacy === '0') return { rejectUnauthorized: false };

  const isLocal =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === 'host.docker.internal' ||
    !hostname.includes('.'); // docker compose service name, e.g. "postgres"
  if (isLocal) return false;

  const managedHost =
    /\.render\.com$/i.test(hostname) ||
    /\.neon\.tech$/i.test(hostname) ||
    /supabase\.co(m)?$/i.test(hostname) ||
    /\.pooler\.supabase/i.test(hostname) ||
    /\.aivencloud\.com$/i.test(hostname) ||
    /\.digitalocean\.com$/i.test(hostname) ||
    /ondigitalocean\.com$/i.test(hostname) ||
    /\.rds\.amazonaws\.com$/i.test(hostname);
  if (managedHost) return { rejectUnauthorized: false };

  return { rejectUnauthorized: true };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: getSslOption(),
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('[DB Pool] Unexpected error on idle client:', err.message);
  // Do NOT exit — the pool creates new connections automatically
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  getSslOption,
};
