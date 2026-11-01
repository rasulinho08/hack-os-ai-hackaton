# Operations

Running HackOS day to day: backups and restores, what to watch, and what to
do when something breaks. The first deploy is in `PRODUCTION_CUTOVER.md`,
the staging copy in `STAGING.md`, secrets in `SECRET_ROTATION.md`.

## Backups

The database holds everything: accounts, organisations, events, scores,
certificates and the uploaded files (photos, logos, submission files live
in the `files` table). A database backup is a full backup.

- **Daily, by the host.** Supabase keeps daily backups on its paid plans
  (Project → Database → Backups); the free plan keeps none. Turn this on
  before the first paying customer.
- **Before every deploy that brings migrations, by you:**

  ```bash
  DATABASE_URL='postgresql://…' bash scripts/db-backup.sh ~/hackos-backups
  ```

  It writes `hackos-<UTC time>.dump` (pg_dump's custom format, the `public`
  schema) and refuses to call it done unless pg_restore can read it. Use the
  session pooler (port 5432) or the direct connection; the transaction
  pooler (6543) cannot run pg_dump. pg_dump must be at least the server's
  major version (`SELECT version();`).
- **Where to keep them.** The file holds personal data and password hashes.
  Keep it in storage only you can open (an encrypted disk or a private
  bucket), never in git, a chat or a shared drive. Keep the last few and
  delete older ones.

## Restoring

`scripts/db-restore.sh` restores into an **empty** database only and refuses
one that already has tables, so it cannot write over live data.

1. Create an empty database: a new Supabase project, or
   `CREATE DATABASE hackos_restore;` on the same server.
2. Restore and read the counts it prints:

   ```bash
   TARGET_DATABASE_URL='postgresql://…/hackos_restore' bash scripts/db-restore.sh ~/hackos-backups/hackos-<time>.dump
   ```

3. Check it with the API before trusting it: start the API against it
   (`DATABASE_URL=… npm start` locally) and confirm the log says
   `schema is up to date`, `/health` answers and you can sign in.
4. To replace production: switch `DATABASE_URL` on Render to the restored
   database and redeploy. Everything written after the backup is lost, so
   this is the last resort. For a single mistake (an event deleted, scores
   overwritten) restore into a scratch database and copy back only those
   rows.

Rehearse a restore every few months, and once before launch. On a copy of
the development database (70 tables, ~2,900 files, 21 MB) the backup takes
about 3 s and the restore about 3 s.

## What to watch

| What | Where | How often |
|---|---|---|
| API is up | `https://hackos-api.onrender.com/health` → `{"status":"ok"}` | uptime monitor, every 1–5 min |
| Web app is up | `https://www.hack-os.app/` and `https://app.hack-os.app/login` → 200 | uptime monitor, every 5 min |
| Platform status | `GET /api/public/status`: API, database, background jobs, e-mail; 503 when the database is down. Public page: `/status` | uptime monitor on the 503, and when users report trouble |
| Background jobs | Owner console → Health: queue, recent failures | daily during an event |
| Errors | Render → hackos-api → Logs (`[jobs] … failed for good`, `[migrate]`, stack traces) | after each deploy, and when the console shows failures |
| Database size | Supabase → Reports (the free plan stops at 500 MB; uploads count) | weekly |
| E-mail | Resend → Logs (bounces, refusals); Settings → E-mail delivery sends a test | weekly, and after DNS changes |

Any uptime service works (UptimeRobot, Better Stack, Uptime Kuma). Point its
alerts at an address and a phone you read. On Render's free plan the API
sleeps after 15 minutes without traffic; the first request then takes
30–60 s, and a monitor keeps waking it. A paid plan is needed for chat,
the job queue and scheduled announcements to run on time.

`/status` shows "Working, with problems" whenever e-mail is not set up, so
set up Resend before you send customers there.

## When something breaks

1. **Look before you act.** Open `/api/public/status` and the owner
   console's Health page, read the last Render log lines, and check
   status.supabase.com / status.render.com / vercel-status.com.
2. **Tell the users.** Owner console → Settings → Platform notice puts a
   banner on every page (maintenance, an incident, when it is fixed).
3. **A bad deploy:** roll back, then find the cause.
   - Web app: Vercel → Deployments → the previous production deployment →
     Promote to Production (instant).
   - API: Render → hackos-api → Deploys → the previous deploy → Rollback.
     Migrations only add, so the previous code runs on the newer database.
4. **The database is unreachable:** usually the host or the connection
   limit. Check Supabase's status and its connection count. If you use the
   transaction pooler, set `CHAT_PG_LISTEN=off` (see `.env.example`).
5. **Data went wrong:** see Restoring above; prefer copying back the
   affected rows over restoring everything.
6. **A secret leaked:** follow `SECRET_ROTATION.md`. Rotating `JWT_SECRET`
   signs everyone out.
7. **Afterwards:** write down what happened, when, what you did and what
   stops it happening again, and update this file if a step was missing.

## Routine

- **Every deploy:** a backup if it brings migrations; afterwards `/health`,
  `/api/public/stats`, a sign-in, and the Render log showing `[migrate]` and
  `Server running`.
- **Weekly:** the console's job failures, database size, Resend bounces,
  the GitHub Actions runs (each push runs lint and the whole suite).
- **Monthly:** who has access to GitHub, Vercel, Render, Supabase, Resend
  and the domain registrar; two-step sign-in on all of them.
- **Every few months:** a restore rehearsal.
