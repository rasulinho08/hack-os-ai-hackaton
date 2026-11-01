# Telegram Bidirectional Sync — Setup Guide

## Required Environment Variables

Add these to your `.env.local` (or hosting provider's env config).

**Docker / nginx:** if the browser talks only to the **Express API** (`/api/*` → backend), put `TELEGRAM_*` on the **API server** env — the API sends channel messages after `POST /api/announcements`. The Next.js app only needs `NEXT_PUBLIC_API_URL` in that layout.

```bash
# ── Backend
NEXT_PUBLIC_API_URL=https://hackatonhbtnback-end-1.onrender.com

# ── Telegram Integration
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_CHAT_ID=-1001234567890
TELEGRAM_WEBHOOK_SECRET=my-random-secret-string

# ── Telegram → Website (webhook creates announcements on the backend)
TELEGRAM_SERVICE_SECRET=rasul028
# Optional: force all channel posts into one event. If omitted, the backend picks
# the current active (non-archived) event automatically.
# TELEGRAM_DEFAULT_EVENT_ID=1
```

### Variable Reference

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_ENABLED` | No | Set `false` to disable Telegram sync. Default: `true` |
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Numeric channel chat ID (e.g. `-1001234567890`) or `@channel_username` |
| `TELEGRAM_WEBHOOK_SECRET` | Recommended | Secret token for webhook verification |
| `TELEGRAM_SERVICE_SECRET` | Yes (for TG→Web) | Shared secret; must match backend `TELEGRAM_SERVICE_SECRET` |
| `TELEGRAM_DEFAULT_EVENT_ID` | No | If set, Telegram channel posts are stored under this event ID. If omitted, backend uses the **active** event (see `getActiveEvent` in API). |

## Telegram Setup Steps

### 1. Create a Bot
1. Open Telegram, search for **@BotFather**
2. Send `/newbot` and follow prompts
3. Copy the bot token → `TELEGRAM_BOT_TOKEN`

### 2. Create / Use an Announcements Channel
1. Create a Telegram channel (or use existing)
2. Set channel to **public** or **private**
3. Add your bot as a **channel administrator** with "Post Messages" permission

### 3. Get Channel Chat ID
- **Public channel**: Use `@channel_username` format
- **Private channel**: 
  1. Forward a channel message to `@userinfobot` or `@RawDataBot`
  2. The chat ID looks like `-1001234567890`

### 4. Set Webhook URL
After deploying, register the webhook with Telegram:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/api/telegram/webhook",
    "secret_token": "my-random-secret-string",
    "allowed_updates": ["channel_post"]
  }'
```

> **Important**: The webhook URL **must be HTTPS**.

### 5. Verify Webhook
```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

## How It Works

### Website → Telegram
1. Admin creates announcement via dashboard
2. Express API saves to the DB (`POST /api/announcements`)
3. The API then sends to the Telegram channel via Bot API (same process as the DB write)
4. Success/failure is returned in the JSON payload and shown in the dashboard toast

### Telegram → Website
1. Admin posts in Telegram channel
2. Telegram sends webhook to `/api/telegram/webhook`
3. Handler verifies secret + channel + anti-duplication
4. Creates announcement on backend via service secret (`TELEGRAM_SERVICE_SECRET`); event is the active one unless `TELEGRAM_DEFAULT_EVENT_ID` is set

### Anti-Duplication
- Bot-originated messages (from website→Telegram) are detected by comparing `from.id` to the bot's user ID
- An in-memory set of recently sent message IDs provides a secondary guard
- Duplicate loops are prevented without needing a shared database

## Limitations
- **Edit sync**: Only new posts are synced. Editing a Telegram message does not update the website announcement.
- **Delete sync**: Deleting on either side is independent.
- **In-memory dedup**: If the Next.js process restarts, the in-memory sent-set clears. The primary guard (bot ID check) still works.
- **Service secret**: Keep `TELEGRAM_SERVICE_SECRET` aligned between Next.js and the backend. Mismatch returns 401 on create.
- **No active event**: If nothing matches the backend’s active-event query (e.g. all archived), Telegram→webhook create returns 400 until you publish an event or set `TELEGRAM_DEFAULT_EVENT_ID`.
