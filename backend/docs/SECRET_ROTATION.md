# Secret rotation — required

**Status: not done. This is the one item in Phase 1 that cannot be fixed from the code.**

## What happened

`backend/.env` was committed to git in `d70125c` ("first commit") and removed from tracking in `76a44ea` ("prepare for Render deployment"). Removing a file from tracking does not remove it from history: `git show d70125c:.env` still returns its contents, and always will unless the history is rewritten.

The repository is **private**, which limits who can reach it. It does not undo the exposure. Anyone who is now a collaborator, becomes one later, clones the repository, or is present if it is ever made public, can read those values.

No secret values appear in this document. Read them from the commit yourself if you need to confirm which ones changed since.

## Why this is the most urgent item

The file contained `JWT_SECRET`. That value signs every session token. Anyone holding it can mint a token claiming any user id and any role — including `admin`, and now `superadmin` — without touching the login endpoint, without a password, and without leaving anything in the logs that looks unusual. There is no way to detect it after the fact.

The database URL contained the password. If the database accepts connections from outside its host, that is direct access to every participant record on the platform.

## What to rotate, in this order

1. **`JWT_SECRET`** — generate a new value and deploy it.
   Every existing session becomes invalid the moment it changes. **Do not do this during an event.** Pick a quiet window and tell any active organisers they will need to sign in again.

2. **Database password** — rotate in the database, then update `DATABASE_URL` in the deployment environment. Restart the API afterwards; it opens its pool at boot.

3. **`TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`** — revoke the token in @BotFather (`/revoke`), set the new one and a new webhook secret, and restart: with `TELEGRAM_WEBHOOK_URL` set the API registers the webhook again with the new secret at boot (otherwise see docs/TELEGRAM.md). The old `TELEGRAM_SERVICE_SECRET` bridge no longer exists; remove that variable wherever it is still set.

4. **SMTP credentials** — `SMTP_USER` / `SMTP_PASS`. These exist in two places today, the backend and `frontend/src/lib/smtpMail.ts`; both need the new value. Consolidating mail into the backend is Phase 4 and removes that duplication.

5. Any third-party keys added since — check the current `.env` against this list before you finish.

## After rotating

- Confirm the old token no longer works: an API call with a session issued before the change must return 401.
- Confirm mail still sends (staff invite is the easiest to trigger).
- Confirm Telegram still works, if it is wired up: GET /api/telegram/status shows the bot's name, and the Messages page's "Send a test message" reaches the event channel.

## Optional: rewriting history

`git filter-repo --path .env --invert-paths` removes the file from every commit. It rewrites every commit hash, so every clone must be re-cloned and any open branches rebased.

**Rotation is what actually protects you.** History rewriting is hygiene, worth doing once the values it exposes are already dead. Do it in that order, not the reverse.

## Preventing a recurrence

Add a pre-commit hook that refuses to stage a file matching `.env*` unless it is `.env.example`. Both repositories now ignore `.env` correctly — this was verified — so the remaining risk is a new secret file under a new name.
