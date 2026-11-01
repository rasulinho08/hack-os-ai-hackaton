# Telegram

One bot serves the whole platform (decision F1=a). Organisers never create a bot or paste a token: they connect their event's channel to the platform bot, and participants connect their own chat from their profile. Announcements then reach both (see [ANNOUNCEMENTS.md](ANNOUNCEMENTS.md)).

## Setting it up (once, for the platform)

1. In Telegram, talk to **@BotFather** → `/newbot` → pick a name and a username (e.g. `HackOSBot`). Copy the token. Never paste it into a chat, a ticket or the code.
2. In the API's environment (Render → Environment):

   | Variable | Value |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | the token from BotFather |
   | `TELEGRAM_WEBHOOK_SECRET` | a long random string (`openssl rand -hex 32`) |
   | `TELEGRAM_WEBHOOK_URL` | `https://<api-host>/api/telegram/webhook` |

3. Restart. At boot the API calls `setWebhook` with that URL and secret (the log says `[telegram] webhook set`). Without `TELEGRAM_WEBHOOK_URL` nothing is registered; without `TELEGRAM_WEBHOOK_SECRET` the webhook answers 404.
4. Check: `GET /api/telegram/status` (as an organiser) shows `botUsername` and `tokenAccepted: true`.

`TELEGRAM_ENABLED=false` switches the bot off without removing the token. Deliveries then show as *skipped — the Telegram bot is not configured*.

The web app's own `/api/telegram/webhook` route is gone: `https://hack-os.app/api/telegram/webhook` now reaches the API through the app's `/api` proxy, so either URL works for `TELEGRAM_WEBHOOK_URL`. The API's URL is preferred (one hop less).

## What people do

**A participant, judge, mentor or volunteer** — Profile → Telegram → *Connect*. The app opens `t.me/<bot>?start=<code>`; pressing *Start* connects the chat. `/stop` in the chat (or *Disconnect* in the app) undoes it. The code works once and expires after 15 minutes. One chat belongs to one account: connecting it to another account moves it.

**An organiser** — Messages → Telegram channel, either:

- **Code** (any channel or group, also private): add the bot to the channel as an administrator who can post, then post the `/link <code>` command the app shows. The bot removes the command and confirms in the channel. Posting there proves the organiser runs it. The code expires after 30 minutes.
- **@name** (public channels): the bot must be an administrator there, **and** the organiser must have connected their own Telegram first — the API checks with Telegram that this person is the channel's creator or an administrator. The bot being in a channel proves nothing about who is asking, because one bot serves every organisation.

*Send a test message* posts to the channel and shows Telegram's answer. With **copy posts to HackOS** on (the default), what the organiser writes in the channel themselves appears among the event's announcements in the app (first line = title); edits follow. The platform's own posts are never copied back.

## What the bot does with updates

`POST /api/telegram/webhook` (mounted ahead of the per-user rate limiter):

- rejects calls without the right `X-Telegram-Bot-Api-Secret-Token` (constant-time comparison) with 401;
- records each `update_id` and skips repeats (Telegram resends when it gets no answer);
- private chat: `/start <code>` connects, `/start` and anything else answers with how to connect, `/stop` disconnects; it answers in the person's Telegram language (az, ru, otherwise en);
- channel or group: `/link <code>` connects it to the event the code was made for;
- channel posts and their edits: copied into the event's announcements when enabled;
- `my_chat_member`: a person blocking the bot marks their link blocked (no more messages); the bot removed from a channel marks the channel with an error the organiser sees;
- a group upgraded to a supergroup keeps its connection (`migrate_to_chat_id`).

It always answers 200 for an update it read, so Telegram does not resend forever.

## Data

| Table | What |
|---|---|
| `telegram_links` | user ↔ private chat, username, language, `blocked_at` |
| `telegram_link_codes` | one-time codes, **hashed** (SHA-256), purpose user/channel, expiry |
| `event_telegram_channels` | event ↔ channel, title, `mirror_posts`, last post, last error |
| `telegram_updates` | handled update ids (pruned after 7 days) |

## The old single channel

Before organisations, every announcement went to one channel set in `TELEGRAM_CHAT_ID`, whoever wrote it. That is now used **only** for the platform's own events that belong to no organisation; an organisation's event never posts there. `TELEGRAM_SERVICE_SECRET` and `POST /api/announcements/telegram` are removed — the bot's webhook replaces them.

## Testing without Telegram

`tests/fakeTelegram.js` is a stand-in Bot API server (`node tests/fakeTelegram.js 5099`). Start the API with `TELEGRAM_API_BASE=http://127.0.0.1:5099`, any `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET=local-webhook-secret`; `tests/announcements.test.js` drives the webhook itself and reads what the "bot" sent from `/__log`. Chat `999000999` behaves as a person who blocked the bot.
