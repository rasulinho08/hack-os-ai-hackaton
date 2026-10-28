require('dotenv').config();

// --- Validate required env vars ---
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// Reject trivially weak JWT secrets in production (minimum 32 chars)
if (
  process.env.NODE_ENV === 'production' &&
  process.env.JWT_SECRET.length < 32
) {
  console.error(
    'FATAL: JWT_SECRET is too short for production (minimum 32 characters). ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"'
  );
  process.exit(1);
}

if (!String(process.env.NODE_ENV || '').trim()) {
  console.warn('[env] NODE_ENV is not set: running with production behaviour (no debug links or error details in responses).');
}

// --- Global error handlers ---
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION — shutting down:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION — shutting down:', reason);
  process.exit(1);
});

const app = require('./src/app');
const { pool } = require('./src/config/db');
const { runMigrations } = require('./src/db/migrate');
const { bootstrapOwner } = require('./src/db/bootstrapOwner');

const PORT = Number(process.env.PORT) || 5000;

(async () => {
  // Schema is managed by db/migrations/*.sql. Running the (idempotent) runner
  // on boot keeps single-instance deployments simple; set
  // RUN_MIGRATIONS_ON_START=false when migrations are run as a separate step.
  if (String(process.env.RUN_MIGRATIONS_ON_START || 'true').toLowerCase() !== 'false') {
    await runMigrations();
  } else {
    await pool.query('SELECT 1'); // fail fast if the DB is unreachable
  }

  /*
   * The first platform owner, from BOOTSTRAP_SUPERADMIN_EMAIL.
   *
   * Deliberately not fatal: a hosting environment without a shell needs some
   * way to grant the role, but a typo in that variable must not stop the API
   * from serving an event. It logs what it did and carries on.
   */
  try {
    await bootstrapOwner(console);
  } catch (err) {
    console.error('[owner] bootstrap failed:', err.message);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`,
    );
  });

  /*
   * Housekeeping: registration attachments uploaded with a form that was
   * never submitted are removed after a day. Hourly, and once shortly after
   * start; a failure is logged and tried again next hour.
   */
  const { purgeUnclaimed } = require('./src/services/file.service');
  const housekeeping = () => purgeUnclaimed()
    .then((n) => { if (n) console.log(`[files] removed ${n} unclaimed upload(s)`); })
    .catch((err) => console.error('[files] cleanup failed:', err.message));
  setTimeout(housekeeping, 60 * 1000).unref();
  setInterval(housekeeping, 60 * 60 * 1000).unref();

  /*
   * Background jobs (src/jobs): scheduled announcements, Telegram and e-mail
   * deliveries, and the automatic announcement planner, polled every
   * JOBS_INTERVAL_MS (15 s). JOBS_DISABLED=true leaves this instance out —
   * for a second instance that should only serve requests.
   */
  let stopJobs = null;
  if (String(process.env.JOBS_DISABLED || '').toLowerCase() !== 'true') {
    const { startWorker } = require('./src/jobs');
    stopJobs = startWorker();
  }

  // Point Telegram at this server's webhook when TELEGRAM_WEBHOOK_URL is set.
  require('./src/services/telegramLink.service').ensureWebhook()
    .catch((err) => console.error('[telegram] webhook setup failed:', err.message));

  // --- Graceful shutdown ---
  const gracefulShutdown = (signal) => {
    console.log(`${signal} received. Shutting down gracefully...`);
    if (stopJobs) stopJobs();
    // Chat readers waiting for news are answered now, not after their wait.
    require('./src/services/chatBus').close();
    server.close(() => {
      console.log('HTTP server closed.');
      pool.end(() => {
        console.log('DB pool closed.');
        process.exit(0);
      });
    });
    // Force exit after 10s if graceful shutdown fails
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
})().catch((err) => {
  console.error('FATAL: server startup failed:', err.message || err);
  process.exit(1);
});
