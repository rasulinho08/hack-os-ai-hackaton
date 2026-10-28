# HackOS API

Express + PostgreSQL backend for the HackOS hackathon-management platform
(organiser dashboard, hacker portal, mentors, judges, volunteers).

## Quick start (local)

```bash
# 1. A PostgreSQL 16 database (local install or Docker, e.g. `docker run -e POSTGRES_PASSWORD=... -p 5432:5432 postgres:16`)

# 2. API
cp .env.example .env          # set DATABASE_URL + JWT_SECRET
npm ci
npm run seed                  # applies migrations + creates test accounts (see below)
npm run dev                   # http://localhost:5000  (node --watch)
```

Seeded accounts (password `Test1234!`): `admin@test.com`, `mentor@test.com`,
`judge@test.com`, `hacker@test.com`, `hacker2@test.com`, `hacker3@test.com`
(pending). Event code `HBTN2026`.

## Scripts

| command                  | what it does                                                          |
| ------------------------ | --------------------------------------------------------------------- |
| `npm run dev`            | start with `node --watch` (restarts on file changes)                  |
| `npm start`              | start (production)                                                    |
| `npm run migrate`        | apply pending SQL migrations from `db/migrations/`                    |
| `npm run migrate:status` | show applied / pending migrations                                     |
| `npm run seed`           | migrate + insert test users, an event, staff and scoring criteria     |
| `npm test`               | end-to-end API tests (`tests/*.test.js`) against a running server     |

## Database & migrations

The schema lives **only** in `db/migrations/NNNN_name.sql`, applied in order
exactly once and recorded in `schema_migrations`. The runner
(`src/db/migrate.js`) takes a Postgres advisory lock, so several API
instances can boot at the same time safely. Migrations run automatically on
boot (`RUN_MIGRATIONS_ON_START=true`, the default) or as a separate deploy
step (`npm run migrate`).

`0001_baseline.sql` is idempotent (`IF NOT EXISTS` everywhere) — it can be
applied to an empty database or to one created by the old scripts. Those old
scripts (`db_init.sql`, `database/`, `migrations/`) are kept under
`db/legacy/` for reference only; do not run them.

To add a migration: create `db/migrations/0002_short_name.sql` (plain SQL,
idempotent where possible) and restart / run `npm run migrate`.

Backups: `scripts/db-backup.sh` (pg_dump, before every deploy that brings
migrations) and `scripts/db-restore.sh` (into an empty database only). How
to restore, what to monitor and what to do in an incident:
[docs/OPERATIONS.md](docs/OPERATIONS.md).

## Configuration

See `.env.example` — every variable is documented there. The important ones:

- `DATABASE_URL`, `JWT_SECRET` (required)
- `FRONTEND_URLS` — browser origins allowed by CORS
- `COOKIE_SAME_SITE` — `lax` when nginx serves the web app and `/api` on the
  same domain (default); `none` only for cross-domain deployments
- `TRUST_PROXY` — `1` by default; `loopback,uniquelocal` behind nginx + Docker
- E-mail: `RESEND_API_KEY` (or `BREVO_API_KEY` / SMTP) and `MAIL_FROM_EMAIL` on a
  verified domain — see [docs/EMAIL.md](docs/EMAIL.md). Without them production
  sends nothing and says so (`GET /api/mail/status`)
- Telegram variables are optional; the feature is off without them

## Authentication & roles

- `POST /api/auth/login` sets an HTTP-only `access_token` cookie (JWT, 30 days).
  `Authorization: Bearer <token>` is accepted too for non-browser clients.
- Every request re-loads the account from the database, so role changes and
  deletions take effect immediately.
- Roles: `admin` / `org_admin`, `hacker` (`pending`), `mentor`, `judge`,
  `volunteer`. Public registration always creates a `hacker`; staff roles come
  from admin invites (`POST /api/events/:id/invites`) matched by e-mail at
  sign-up.
- Hackers need an **approved** participant row for the event before they can
  form teams; team rosters freeze when the event starts; only the team lead
  submits the project; only the judge who gave a score can edit it.

Error responses always look like
`{ success: false, message, code?, errors? }` where `code` is a stable
identifier (e.g. `TEAM_FORMATION_CLOSED`, `HACKER_NOT_APPROVED`,
`NOT_TEAM_LEAD`, `RATE_LIMITED`).

## Tests

`npm test` runs `tests/e2e.test.js` with Node's built-in runner against
`API_URL` (default `http://localhost:5000`). The suite creates its own event
and users with a unique suffix, so it can be repeated against the same
database; it needs the seeded `admin@test.com` account.

## Docker

`Dockerfile` builds a small production image (`node server.js`, health check
on `/health`). There is no compose file in this repository; run the image next
to a PostgreSQL 16 database and the web app image with the variables from
`.env.example`. The hosted deployment uses `render.yaml` (API) and Vercel (web).

## Production checklist

- `JWT_SECRET` (≥ 32 chars), `DATABASE_URL`, `NODE_ENV=production`.
- `FRONTEND_URLS` must list every browser origin: `https://www.hack-os.app,https://hack-os.app,https://app.hack-os.app`.
- `COOKIE_DOMAIN=.hack-os.app` so a sign-in on www.hack-os.app is valid on app.hack-os.app (logout clears both cookie shapes).
- `TRUST_PROXY` set to the real number of proxy hops, verified by logging `req.ip` once — the failed-login limiter is keyed on it.
- Tenant isolation: events belong to the customer of the organiser who creates them. Events created before this release have no customer; the platform owner assigns them with `PUT /api/events/:id/customer` (or leaves them shared, which is what an unassigned event means).
