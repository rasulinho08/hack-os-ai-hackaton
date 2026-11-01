# Staging

A second, complete copy of HackOS — its own database, API and web app — where
every change is tried before it reaches hack-os.app. Nothing on staging can
touch production data, and production sessions do not work there.

| | Production | Staging |
| --- | --- | --- |
| Git branch (both repositories) | `production` (today: `main`, until the hosts are switched) | `staging` |
| Database | Supabase project used today | a **new** Supabase project, e.g. `hackos-staging` |
| API (Render) | `hackos-api` | `hackos-api-staging` |
| Web app (Vercel) | hack-os.app, www, app., admin. | the `staging` branch's preview address (`…-git-staging-….vercel.app`) |

Work lands on `staging` first. Production is updated only after it has been
checked there and the owner has said yes.

## 1. Database — Supabase

1. supabase.com → **New project**. Name `hackos-staging`, region closest to
   Baku (Frankfurt), a strong database password (store it in your password
   manager; it is not needed anywhere else).
2. Project → **Connect** → **Session pooler** → copy the URI. It looks like
   `postgresql://postgres.<ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`.
   Use the session pooler, not the direct connection: Supabase's direct host
   is IPv6-only unless you buy its IPv4 add-on, and Render connects over IPv4.
3. Nothing else. The API creates every table itself on first start
   (`RUN_MIGRATIONS_ON_START=true`). The database starts empty — no production
   rows are copied, so no participant's personal data is on staging.

## 2. API — Render

1. render.com → **New → Web Service** → this repository → branch **`staging`**.
   - Name `hackos-api-staging`, region Frankfurt, runtime Node.
   - Build `npm ci`, start `npm start`, health check path `/health`.
2. Environment variables (Settings → Environment):

   | Key | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | the session-pooler URI from step 1 |
   | `JWT_SECRET` | **a new random value** — never production's (`openssl rand -hex 48`) |
   | `RUN_MIGRATIONS_ON_START` | `true` |
   | `FRONTEND_URL` | the staging web address from step 3 (fill in after step 3) |
   | `FRONTEND_URLS` | same as `FRONTEND_URL` |
   | `SUPERADMIN_EMAILS` | your address |
   | `SUPERADMIN_PIN` | a 6-digit code — use a different one from production |
   | `SALES_NOTIFY_EMAIL` | your address |
   | `RESEND_API_KEY`, `MAIL_FROM_EMAIL` | optional; without them staging sends no e-mail and says so in Settings |

   Leave `COOKIE_DOMAIN` **unset** on staging. If it were `.hack-os.app`,
   staging and production would hand each other session cookies of the same
   name and both would sign people out at random.
3. Deploy. The log should show `[migrate] applied N migration(s)` and then
   `Server running on port …`. Open `https://hackos-api-staging.onrender.com/health`.

The free plan sleeps after 15 minutes without traffic; the first request after
that takes up to a minute. That is fine for staging.

## 3. Web app — Vercel

The project already builds every branch. Pushing `staging` creates a preview
deployment whose address is shown under **Deployments → staging**.

1. Vercel → project → **Settings → Environment Variables** → add, each with
   environment **Preview** and branch **`staging`** only:

   | Key | Value |
   | --- | --- |
   | `NEXT_PUBLIC_API_URL` | `https://hackos-api-staging.onrender.com` |

   Do **not** set `NEXT_PUBLIC_MARKETING_HOSTS`, `NEXT_PUBLIC_APP_ORIGIN` or
   `NEXT_PUBLIC_ADMIN_HOST` for staging. Unset, the whole product answers on
   one address: the landing page at `/welcome`, the platform at `/login`, the
   owner console at `/workspace` (password, then the 6-digit code).
2. **Deployments** → the latest `staging` deployment → **Redeploy** (the
   `NEXT_PUBLIC_` values are baked in at build time).
3. Optional: Settings → Deployment Protection → keep Vercel Authentication on
   for previews, so only you can open staging.
4. Put the staging address into the API's `FRONTEND_URL`/`FRONTEND_URLS`
   (step 2) so links in e-mails point at staging.

## 4. First sign-in

1. Open the staging address → `/signin` → **Create account** with your e-mail.
2. Because your address is in `SUPERADMIN_EMAILS`, make it the owner once:
   set `BOOTSTRAP_SUPERADMIN_EMAIL` to your address on the staging API,
   redeploy, check the log line `[owner] … → superadmin`, then remove the
   variable (see `OWNER_SETUP.md`).
3. Open `/workspace`: password, then the 6-digit `SUPERADMIN_PIN`.

## 5. Demo data (optional)

To have something on every screen, seed one organisation on the
Professional annual plan and a live event with a person in every role:

```
DATABASE_URL='<staging session-pooler URI>' DEMO_PASSWORD='<10+ characters>' \
  npm run seed:demo -- --confirm
```

Run it from your own machine (Render's free plan has no shell). It prints
the accounts — `demo.organiser@demo.hack-os.app`, two judges, two mentors, a
volunteer and twelve participants in three teams — all signing in with
`DEMO_PASSWORD`. It refuses without `--confirm`, never touches rows it did
not create, and is safe to run again. Never point it at production.

## 6. Moving a change to production

1. It has been checked on staging.
2. The owner has approved it.
3. Merge `staging` into `production` (or `main`, until the hosts deploy from
   `production`) in both repositories, API first when a change needs both.
4. Migrations run on the production API's next start. They only ever add
   (new tables, new columns, backfills); none drops or rewrites data. Read the
   new files under `db/migrations/` before merging all the same.

## Switching production to the `production` branch

Today Render and Vercel deploy production from `main`. To make `production`
the branch that deploys:

- Render → `hackos-api` → Settings → Branch → `production`.
- Vercel → Settings → Git → Production Branch → `production`.

From then on a push to `main` changes nothing live.
