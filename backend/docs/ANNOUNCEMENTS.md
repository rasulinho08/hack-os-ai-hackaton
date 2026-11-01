# Announcements

An organiser writes an announcement, picks **who** it is for, **where** it goes besides the app, and **when**. Readers see the ones meant for them. Deliveries happen in the background and are reported back.

## Who (audience)

| Audience | Reaches |
|---|---|
| `everyone` | every participant who was not rejected, and the event's judges, mentors and volunteers |
| `participants` | approved participants (still competing) |
| `waiting` | participants waiting for approval or on the waiting list |
| `no_team` | approved participants without a team |
| `no_submission` | approved participants whose team has not submitted |
| `track` | approved participants whose team is in one track (`trackId` of this event) |
| `staff`, `judges`, `mentors`, `volunteers` | the event's staff |

The same rule decides who sees it in the app and who is e-mailed or messaged (`src/services/announcementAudience.js`). Organisers see every announcement of their event, with its delivery report; they are not recipients. `GET /api/announcements/audience?eventId=&audience=&trackId=` tells the composer how many people that is, how many have an e-mail address and how many connected Telegram.

## Where (channels)

- `platform` — always: the announcement appears in the app.
- `telegram` — a message to everyone in the audience who connected Telegram, and a post in the event's channel when the audience is `everyone` or `participants` (a note to the judges does not belong in a public channel). Needs the plan's `telegram` module.
- `email` — one e-mail per person, in the event's language, signed the way the event signs its mail (builder → Communication). At most **20 e-mail announcements per event per day** (`EMAIL_LIMIT`); automatic ones are not counted.

## When

`scheduledAt` (at least 30 seconds and at most a year ahead) makes it `scheduled`: visible to organisers only, published by the worker at that moment. A scheduled announcement can be moved (`PUT`), sent now (`POST /:id/send-now`) or cancelled (`POST /:id/cancel`). Once sent, its words can still be corrected — the app copy and the channel post follow; e-mails and messages already sent stay as they were — but its audience, channels and time cannot.

Deleting an announcement also takes its post down from the event's channel.

## API

| | |
|---|---|
| `GET /api/announcements?eventId=` | organisers: all, with `deliveries` counts; others: sent ones meant for them |
| `GET /api/announcements` | organisers: every event they run; others: the event they are working in |
| `POST /api/announcements` | `{ eventId, title, content, type, priority, audience, trackId?, channels: ['telegram','email'], scheduledAt? }` |
| `PUT /api/announcements/:id` | partial update (see *When*) |
| `POST /api/announcements/:id/cancel` · `/send-now` | scheduled ones only |
| `GET /api/announcements/:id/deliveries` | `{ report: { email: { sent, failed, pending, skipped }, telegram: …, telegram_channel: … }, problems: [...] }` |
| `DELETE /api/announcements/:id` | |

Errors carry codes: `ANNOUNCEMENT_INVALID` with `errors: [{ field, code }]` (`REQUIRED`, `TOO_LONG`, `INVALID`, `IN_PAST`, `TOO_FAR`), `EMAIL_LIMIT`, `MODULE_DISABLED`, `NOT_SCHEDULED`, `ANNOUNCEMENT_CANCELLED`, `USE_SEND_NOW`. Another organisation's event is a 404, never a 403.

## Delivery

Publishing plans one `announcement_deliveries` row per e-mail, per Telegram message and per channel post (unique, so repeating never sends twice), then `announcement.deliver` jobs work through them 25 at a time per channel. Each row has its own attempts and error:

- delivered → `sent` (the Telegram message id is kept, so edits and deletions can follow);
- not deliverable and not an error → `skipped` with the reason (no address, the person blocked the bot, no mail provider in development);
- refused for good (a 4xx from Telegram, an invalid address) or after 4 attempts → `failed`;
- otherwise retried after 1, 5 and 30 minutes, or when Telegram says (`retry_after`).

A person who blocked the bot is marked and not messaged again until they press *Start*.

## Automatic announcements (F8)

Switched on per event in the builder (Messages): registration closes in 24 h / closed, coding starts in 30 min / started, 24 h and 1 h to submit, submissions closed, presentations in 1 h, results out, certificates ready. The worker looks once a minute (`AUTO_ANNOUNCE_EVERY_MS`) at published events with such a moment near, and sends each once (`event_auto_announcements`), in the event's language and time zone, to the audience that makes sense (*1 h to submit* only to those who have not submitted). Each has a window after its moment: a server that slept through "coding starts in 30 minutes" does not send it afterwards. *Results* and *certificates* are sent when results are published and certificates issued (`autoAnnouncementPlanner.trigger`). They need the plan's `automations` module. *1 h to submit*, *submissions closed* and *results* also go by e-mail.

Events that existed before this feature have every automatic announcement switched off (migration 0014): their organisers never chose them.

## The worker

`src/jobs` — a queue in Postgres (`jobs`), no extra service. Every API instance polls every `JOBS_INTERVAL_MS` (15 s), claims due jobs with `FOR UPDATE SKIP LOCKED`, retries failures with growing delays (30 s, 2 min, 8 min… up to 6 h, 5 attempts), returns jobs a crashed instance left `running` after 10 minutes, and prunes finished jobs after 14 days. `JOBS_DISABLED=true` leaves an instance out. A scheduled announcement whose job went missing is published by a sweep anyway.

On a host that sleeps (Render's free plan), jobs run when it wakes; time-bound messages that are too late are not sent. An always-on instance is recommended for live events.
