# Production cutover

Moving the live platform (`hack-os.app`, `app.hack-os.app`,
`hackos-api.onrender.com`) from what `main` runs today to the code on
`staging`: the B2B rebuild (phases 1–7). Nothing here is done automatically —
each step is a person's decision, and the owner's explicit "yes" comes first.

What changes in one go:

| | Today (`main`) | After |
|---|---|---|
| Database | migrations 0001–0009 | 0001–0026: 17 new migrations |
| API | `5babdf9` | the `staging` head of hack-os-backend |
| Web app | `main` of hack-os-frontend | the `staging` head of hack-os-frontend |
| Hosts | landing + app | landing, app, and the owner console on `admin.hack-os.app` |

## What the database migrations do

- They only add: new tables, new columns, new indexes, and backfills of new
  columns. None of 0010–0026 contains `DROP TABLE`, `DROP COLUMN`, `DELETE`,
  `TRUNCATE` or a column type change. The constraints and triggers they drop
  are recreated in the same file.
- Each file runs in its own transaction, under an advisory lock, when the API
  starts (`RUN_MIGRATIONS_ON_START`, on by default). A file that fails rolls
  back by itself and the API does not start; the files before it stay applied.
- Backfills that touch existing rows: organisation memberships from customer
  contacts (0010), order lifecycle fields (0011), event builder defaults
  (0012), job/announcement fields (0014), mentor/volunteer fields (0017),
  judging and results fields (0019), and **every existing account is marked
  as e-mail-confirmed** (0022 — only accounts created afterwards are asked to
  confirm).
- Checked locally: the code on `main` (`5babdf9`) starts against a database
  with all 26 migrations applied and answers its organiser, participant and
  judge routes — 39 calls including writes, no server errors. So putting the
  previous API deploy back is a working rollback for the code.

## 1. Before the day

1. **Staging works.** The staging API service exists on Render (it does not
   yet — see `docs/STAGING.md`) and the whole flow has been clicked through
   there: purchase → approval → setup → event → registration → judging →
   results → certificate.
2. **Back up production.** Supabase → Project → Database → Backups (a manual
   backup), or from your own machine:
   `DATABASE_URL="$PRODUCTION_SESSION_POOLER_URL" bash scripts/db-backup.sh ~/hackos-backups`.
   Keep the file somewhere safe; it holds personal data (`docs/OPERATIONS.md`).
3. **Dry run on a copy.** Restore that backup into an empty staging database
   (`TARGET_DATABASE_URL=… bash scripts/db-restore.sh <file>`), start the
   staging API once against it, and read the log: it should list
   0010 … 0026 as applied and end with the server listening. Then sign in as
   an existing organiser and an existing participant and open their events.
   This is the step that would catch real production data the migrations did
   not expect.
4. **Decide on automatic archiving.** With `AUTO_ARCHIVE` on (the default),
   every published event that ended more than 14 days ago is archived (made
   read-only) by the hourly sweep after the first start — that includes the
   old events. Organisers can bring one back. If that is not wanted yet, set
   `AUTO_ARCHIVE=off` for the first days.
5. **Render plan.** The free instance sleeps after 15 minutes: the chat's
   long poll, scheduled announcements, archiving and reminders all need an
   instance that stays up (Starter or higher).
6. **Domains and mail.**
   - Vercel → Settings → Domains: add `admin.hack-os.app`.
   - Resend → Domains: verify `hack-os.app` (the SPF, DKIM and DMARC records
     it shows go into the DNS of `hack-os.app`).
7. **Environment variables** — set them before the deploy, so the first start
   already has them.

   API (Render → hackos-api → Environment), new or newly important:

   | Variable | What to put |
   |---|---|
   | `SUPERADMIN_EMAILS` | the owner's e-mail (the only accounts that may act as owner) |
   | `SUPERADMIN_PIN` | the owner's second-step code — never in git or chat |
   | `APP_ORIGIN` | `https://app.hack-os.app` (setup links lead there) |
   | `FRONTEND_URL`, `FRONTEND_URLS` | `https://hack-os.app` and every web host, comma-separated |
   | `COOKIE_DOMAIN` | `.hack-os.app` (one session across the hosts) |
   | `DATA_ENCRYPTION_KEY` | `openssl rand -base64 32`; store it in a password manager — a lost key makes the encrypted room links unreadable |
   | `INVITE_TOKEN_SECRET` | optional; a long random string for invitation and calendar links (falls back to `JWT_SECRET`) |
   | `RESEND_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` | after the domain is verified in Resend |
   | `SALES_NOTIFY_EMAIL` | the inbox for new orders and contact-form messages |
   | `SEND_EMAIL_ON_EVENT_INVITE` | `true` once mail works: a judge, mentor or volunteer invited by an address with no account then gets the invitation by e-mail. Off (the default), the organiser has to copy the invitation link from the builder and pass it on |
   | `INVOICE_SELLER_*`, `INVOICE_BANK_*` | fallback for the seller and bank details printed on invoices; the owner sets them in the console (Settings → Billing and invoices) |
   | `PAYMENT_CARD_PROVIDER` | leave unset until a card provider is connected (checkout is then bank transfer only) |
   | `CHAT_PG_LISTEN` | `off` if `DATABASE_URL` is Supabase's *transaction* pooler (port 6543); keep the session pooler and leave it on |
   | `STORAGE_DB_MAX_MB` | uploads are stored in Postgres; on Supabase's free plan (500 MB) keep it at 300 or below |
   | `AUTO_ARCHIVE` | see step 4 |
   | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_URL` | if Telegram is used (`docs/TELEGRAM.md`); with all three set the API registers the webhook itself at boot |
   | `GITHUB_TOKEN` | optional; a token with no permissions raises GitHub's limit for repository checks |

   Web app (Vercel → Settings → Environment Variables, Production):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://hackos-api.onrender.com` |
   | `NEXT_PUBLIC_MARKETING_HOSTS` | `hack-os.app,www.hack-os.app` |
   | `NEXT_PUBLIC_APP_ORIGIN` | `https://app.hack-os.app` |
   | `NEXT_PUBLIC_SITE_URL` | `https://www.hack-os.app` (or the apex, whichever is canonical) |
   | `NEXT_PUBLIC_ADMIN_HOST` | `admin.hack-os.app` |
   | `NEXT_PUBLIC_LEGAL_NAME`, `NEXT_PUBLIC_LEGAL_TAX_ID`, `NEXT_PUBLIC_LEGAL_ADDRESS` | the company's registered details for the legal pages, once known |

   `NEXT_PUBLIC_*` values are built into the app: change them before the
   deploy, or redeploy after changing them.

## 2. The cutover

Pick a quiet hour and tell current customers beforehand (the owner console's
platform notice exists only after the deploy).

1. **API first.** Merge `staging` into `main` in hack-os-backend. Render
   deploys; watch the log until the migrations are listed and the server is
   listening. A failed migration names the file and the error — stop there
   and use the rollback below.
2. Check the API: `GET /health` → 200; `GET /api/public/stats` → numbers.
3. **Web app.** Merge `staging` into `main` in hack-os-frontend. Vercel builds
   and promotes it.
4. **Owner.** Open `https://admin.hack-os.app`, sign in with the owner account
   and the second-step code. If the owner account is not a superadmin yet,
   follow `docs/OWNER_SETUP.md`.
5. **Telegram** (if used): the log says `[telegram] webhook set`.

## 3. Smoke test on production

- The home page loads with live figures, the pricing page and the four legal
  pages open, in AZ, EN and RU.
- An existing organiser signs in at `app.hack-os.app`, opens an old event and
  sees its participants, teams and scores.
- An existing participant signs in and sees their team.
- A new account gets the confirmation e-mail (Resend's dashboard shows it
  delivered).
- A test order with bank transfer reaches the owner console; reject it there
  (it is not charged).
- Owner console → Health: database, jobs and mail all green.
- A certificate's public check page (`/verify/<code>`) opens, if certificates
  were issued.

## 4. Rollback

- **Web app:** Vercel → Deployments → the previous production deployment →
  Promote to Production (instant).
- **API:** Render → hackos-api → Deploys → the previous deploy → Rollback.
  The old code runs on the migrated database (checked, see above); the new
  tables simply go unused.
- **Data:** only if data itself went wrong — restore the backup from step 2
  of "Before the day". Everything written after the backup is lost, so this is
  the last resort.

## 5. After

- Remove `BOOTSTRAP_SUPERADMIN_EMAIL` if it was used.
- Turn `AUTO_ARCHIVE` on if it was switched off.
- Put an uptime check on `https://hackos-api.onrender.com/health`.
- Keep Supabase backups on a schedule (daily on a paid plan).
- Switch both hosts to deploy from a `production` branch
  (`docs/STAGING.md` → "Switching production to the `production` branch").
