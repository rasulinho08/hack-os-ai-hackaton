# Webhooks

HackOS can tell your own systems — a CRM, a spreadsheet automation, Slack through Zapier, Make or n8n, your own service — when something happens in your organisation's events: someone registers, is accepted, a team forms, a project is submitted, results or certificates go out. HackOS sends an HTTPS `POST` with a JSON body to an address you choose, signed so you can check it came from HackOS.

Webhooks are part of the **Business** and **Enterprise** plans. The organisation's **owner and administrators** manage them in the app under **Account → Webhooks**; organisers and viewers cannot see or change them.

## Setting up an endpoint

1. **Account → Webhooks → Add endpoint.** Enter the URL that should receive the requests and choose what it should hear about (or everything). A description helps you tell endpoints apart.
2. **Copy the signing secret** (`whsec_…`). It is shown **once**, right after the endpoint is created. HackOS keeps it encrypted and never shows it again; if you lose it, rotate it (step 5).
3. **Send a test.** HackOS sends a `ping` (below) and the delivery log shows what your server answered.
4. Use the **delivery log** to see every delivery: the HTTP status your server returned, the error if there was none, the first characters of your answer, how long it took, and the next attempt when one is planned. **Redeliver** sends any finished delivery again.
5. **Rotate the secret** when it may have leaked or someone who knew it leaves. The new secret signs every request from that moment; the old one stops working at once.

The URL must:

- start with `https://`;
- point at a public address: HackOS refuses hosts that resolve to loopback, private networks (10/8, 172.16/12, 192.168/16, fc00::/7), carrier-grade NAT (100.64/10), link-local addresses (169.254/16 — including cloud metadata services — and fe80::/10), multicast, reserved or unspecified addresses, also when written inside IPv6 (`::ffff:10.0.0.1`). This is checked when you save the endpoint **and again before every delivery**, against the address the request actually connects to;
- not carry a user name or password (`https://user:pass@…`) — the signature is what proves a request is genuine;
- answer itself: **redirects are not followed** (a `3xx` counts as a failure).

An organisation can have up to **10 endpoints**. Each has its own secret.

## Events

| Type | Sent when | `data` |
|---|---|---|
| `registration.created` | someone registers for an event — the public form, an invitation, a team invite, or an organiser adding them | `participant` |
| `participant.approved` | a participant is accepted — by an organiser, in bulk, from the waiting list, or straight away when the event accepts everyone | `participant`, `previous_status` |
| `participant.rejected` | a participant is turned down | `participant`, `previous_status` |
| `team.created` | a team is formed | `team` |
| `submission.created` | a team submits its project | `submission`, `team` |
| `results.published` | results are published, the first time and again after each correction (`first` tells which) | `first`, `published_at`, `visibility`, `show_scores`, `results` |
| `certificate.issued` | certificates are issued; those issued together arrive in one delivery (up to 200 per delivery) | `certificates` |
| `event.published` | an event goes public | `event` |
| `ping` | you press **Send test** | `message`, `endpoint_id` |

A registration that is accepted on the spot (events that accept everyone) sends both `registration.created` and `participant.approved`.

## The request

```http
POST /your/path HTTP/1.1
Content-Type: application/json
User-Agent: HackOS-Webhooks/1.0 (+https://www.hack-os.app)
X-HackOS-Event: participant.approved
X-HackOS-Delivery: 2f0c6c2e-8f4e-4c8e-9a39-6a1f1d7a3b52
X-HackOS-Timestamp: 1792432985
X-HackOS-Signature: sha256=5d7c0f4f0b1c…
```

| Header | Meaning |
|---|---|
| `X-HackOS-Event` | the type, the same as `type` in the body |
| `X-HackOS-Delivery` | this delivery to this endpoint; the same on every retry of it, new for a redelivery |
| `X-HackOS-Timestamp` | when this attempt was signed, in seconds since 1970 (UTC) |
| `X-HackOS-Signature` | `sha256=` and the hex HMAC-SHA256 of `<timestamp>.<raw body>` with your secret |

Every body has the same envelope:

```json
{
  "id": "504bf3b2-39b5-4b59-8a28-0886bf8afe30",
  "type": "participant.approved",
  "created_at": "2026-10-19T17:59:25.297Z",
  "organisation_id": 870,
  "event": { "id": 1938, "slug": "baku-ai-2026", "name": "Baku AI Hackathon 2026" },
  "data": {
    "participant": {
      "id": 3484,
      "status": "approved",
      "registered_at": "2026-10-19T17:59:23.659Z",
      "user": { "id": 5553, "name": "Leyla Məmmədova", "email": "leyla@example.com" },
      "team": null
    },
    "previous_status": "pending"
  }
}
```

- `id` identifies **what happened**. It is the same in every endpoint's copy, in every retry and in redeliveries — use it to ignore a delivery you have already handled.
- `created_at` is when it happened in HackOS (not when this attempt was sent).
- `organisation_id` is your organisation. A delivery only ever carries your own organisation's events.
- `event` is the hackathon it happened in (`null` for `ping`).
- New fields may be added to `data` over time; ignore the ones you do not know.

### `data` for each type

**`registration.created`, `participant.approved`, `participant.rejected`** — `participant.status` is the status at the moment it happened (`pending`, `waitlisted`, `approved` or `rejected`); `previous_status` (approved and rejected only) is what it was before.

**`team.created`**

```json
{
  "team": {
    "id": 1123,
    "name": "Qarmaq",
    "created_at": "2026-10-19T17:59:29.310Z",
    "track": { "id": 12, "name": "FinTech" },
    "leader": { "id": 5553, "name": "Leyla Məmmədova" },
    "members": 3
  }
}
```

**`submission.created`**

```json
{
  "submission": {
    "id": 594,
    "project_name": "Qarmaq",
    "description": "Webhooks for everyone",
    "repo_url": "https://github.com/example/qarmaq",
    "demo_url": null,
    "presentation_url": null,
    "video_url": null,
    "tech_stack": "Node.js, PostgreSQL",
    "submitted_at": "2026-10-19T17:59:31.346Z"
  },
  "team": { "id": 1123, "name": "Qarmaq" }
}
```

(`description` is cut at 4,000 characters.)

**`results.published`** — the published ranking, up to 500 places. `score` is present only when the organiser chose to show scores (`show_scores`).

```json
{
  "first": true,
  "published_at": "2026-10-19T17:59:33.380Z",
  "visibility": "own_and_winners",
  "show_scores": false,
  "results": [
    { "place": 1, "team": { "id": 1123, "name": "Qarmaq" }, "project_name": "Qarmaq", "track": null }
  ]
}
```

**`certificate.issued`**

```json
{
  "certificates": [
    {
      "id": 894,
      "code": "K7QM-2WXN-PA4D",
      "kind": "winner",
      "title": "First place",
      "place": 1,
      "recipient": { "user_id": 5553, "name": "Leyla Məmmədova" },
      "team": { "id": 1123, "name": "Qarmaq" },
      "issued_at": "2026-10-19T17:59:35.410Z",
      "verify_url": "https://www.hack-os.app/verify/K7QM-2WXN-PA4D"
    }
  ]
}
```

`kind` is `participation`, `winner`, `special`, `judge`, `mentor` or `volunteer`.

**`event.published`**

```json
{
  "event": {
    "id": 1938,
    "slug": "baku-ai-2026",
    "name": "Baku AI Hackathon 2026",
    "tagline": "Build with AI in 36 hours",
    "start_date": "2026-11-20T08:00:00.000Z",
    "end_date": "2026-11-21T20:00:00.000Z",
    "timezone": "Asia/Baku",
    "format": "offline",
    "city": "Baku",
    "country": "AZ",
    "public_url": "https://www.hack-os.app/e/baku-ai-2026"
  }
}
```

**`ping`**

```json
{ "message": "A test from HackOS: this endpoint is set up.", "endpoint_id": 29 }
```

## Checking the signature

Do this for every request, before you trust anything in it:

1. Read the **raw body bytes** — before any JSON parsing, which can change spacing or key order.
2. Compute HMAC-SHA256 with your secret (the whole string, `whsec_` included) over the timestamp header, a dot, and the raw body: `<X-HackOS-Timestamp>.<raw body>`. Write it as lowercase hex and put `sha256=` in front.
3. Compare it with `X-HackOS-Signature` in **constant time**.
4. Refuse a timestamp more than **5 minutes** away from your clock, so a recorded request cannot be replayed later.

Answer `401` when the check fails. HackOS treats it like any other failure and tries again, which is what you want if, say, you rotated the secret and have not deployed the new one yet.

### Node.js (Express)

```js
const crypto = require('crypto');
const express = require('express');

const SECRET = process.env.HACKOS_WEBHOOK_SECRET; // whsec_…
const app = express();

app.post('/hackos', express.raw({ type: 'application/json' }), (req, res) => {
  const timestamp = req.get('X-HackOS-Timestamp') || '';
  const signature = req.get('X-HackOS-Signature') || '';
  const expected = `sha256=${crypto.createHmac('sha256', SECRET)
    .update(`${timestamp}.`)
    .update(req.body) // the raw bytes (express.raw)
    .digest('hex')}`;
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300;
  const genuine = signature.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!fresh || !genuine) return res.sendStatus(401);

  const event = JSON.parse(req.body);
  res.sendStatus(204); // answer first …
  handle(event); // … then do the work (de-duplicate on event.id)
});

app.listen(3000);
```

### Python

```python
import hashlib
import hmac
import time

def hackos_signature_ok(secret: str, timestamp: str, signature: str, body: bytes) -> bool:
    """body: the raw request body, exactly as received."""
    if not timestamp.isdigit() or abs(time.time() - int(timestamp)) > 300:
        return False
    digest = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, "sha256=" + digest)
```

With Flask:

```python
import json
import os
from flask import Flask, abort, request

app = Flask(__name__)
SECRET = os.environ["HACKOS_WEBHOOK_SECRET"]

@app.post("/hackos")
def hackos():
    if not hackos_signature_ok(
        SECRET,
        request.headers.get("X-HackOS-Timestamp", ""),
        request.headers.get("X-HackOS-Signature", ""),
        request.get_data(),  # raw bytes
    ):
        abort(401)
    event = json.loads(request.get_data())
    queue_for_later(event)  # de-duplicate on event["id"]
    return "", 204
```

## Answering, retries and switching off

- Answer with any **2xx** status within **10 seconds**. Anything else is a failure: another status, no answer in time, a connection or TLS error, a redirect. Do the real work after answering (a queue or a background job), not before.
- A failed delivery is tried again **1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours** later — six attempts over about 15 hours. Each attempt sends the same body and the same `X-HackOS-Delivery`, with a fresh timestamp and signature.
- Deliveries can arrive **more than once** and **out of order** (a retry can land after a newer delivery). De-duplicate on `id`, and use `created_at` or the status inside `data` rather than the order of arrival.
- When **5 deliveries in a row** have used up all their attempts, HackOS **switches the endpoint off** and tells the organisation's owner and administrators in the notification centre. Nothing is sent to it while it is off. Fix the receiver, switch it back on in **Account → Webhooks**, and redeliver what it missed from the delivery log.
- A **test** and a **redelivery** are tried once, and never count toward switching an endpoint off. You can send a test to an endpoint that is switched off, to check it works before switching it on.
- The delivery log keeps the last **30 days**.

## Good practice

- Check the signature and the timestamp on every request; refuse the rest.
- Keep the secret where you keep passwords (an environment variable or a secret store), never in code or a repository. Rotate it if it may have been seen.
- Subscribe only to what you use. Registrations carry people's names and e-mail addresses: what you store from them falls under the same data-protection duties as anything else you keep about them.
- Answer fast and queue the work, so slow processing never turns into timeouts and retries.
- Rely on the signature, not on an address allowlist: the address HackOS sends from depends on its hosting and can change.

## For operators

| Variable | Default | Meaning |
|---|---|---|
| `WEBHOOKS_ALLOW_PRIVATE_TARGETS` | `true` when `NODE_ENV` is `development` or `test`, `false` otherwise (an unset `NODE_ENV` included) | allows `http://` and loopback or private-network targets — for local development, tests and installations that deliver inside their own network. Link-local, multicast and unspecified addresses stay refused either way. Never turn it on for a public installation. |
| `WEBHOOK_WRITE_LIMIT_PER_MIN` | `30` | creating, editing and rotating, per account per minute |
| `WEBHOOK_SEND_LIMIT_PER_MIN` | `20` | tests and redeliveries, per account per minute |
| `DATA_ENCRYPTION_KEY` | — | seals endpoint URLs and secrets in the database (see SECRET_ROTATION.md); without it they are stored as they are |

How it works: a database trigger writes what happened to `webhook_outbox` in the same transaction as the change, only for organisations with an active endpoint for that kind. The worker (`src/jobs/webhookJobs.js`) turns those rows into `webhook_deliveries` and sends them as `webhook.deliver` jobs. A row whose payload could not be built is set aside with its `error` and logged (`[webhooks] … set aside`); once the cause is fixed, `UPDATE webhook_outbox SET processed_at = NULL, error = NULL WHERE error IS NOT NULL;` sends those too. An attempt still running after 2 seconds carries on beside the job queue (at most 8 per API process), so a slow receiver never holds up e-mails or announcements; attempts cut short by a restart are queued again within about 15 minutes.

## API

For the app; all routes need a signed-in owner or administrator of the organisation. Add `?customerId=` (or `customerId` in the body) to pick one of several organisations; the platform owner can name any.

| Method and path | |
|---|---|
| `GET /api/account/webhooks` | the endpoints, the event types, whether the plan includes webhooks, and the organisations you can pick (`organisations`) |
| `POST /api/account/webhooks` | `{ url, events, description? }` → `{ endpoint, secret }` (the secret only here) |
| `PATCH /api/account/webhooks/:id` | `{ url?, events?, description?, active? }` |
| `DELETE /api/account/webhooks/:id` | the endpoint and its delivery log |
| `POST /api/account/webhooks/:id/rotate` | → `{ endpoint, secret }` |
| `POST /api/account/webhooks/:id/test` | queue a `ping` → `202 { delivery }` |
| `GET /api/account/webhooks/:id/deliveries?limit=&before=` | newest first, `limit` up to 50; `nextBefore` pages back |
| `POST /api/account/webhooks/:id/deliveries/:deliveryId/redeliver` | → `202 { delivery }`; `409 DELIVERY_PENDING` while it is still being tried |

`events` is a list of the types above, or `["*"]` for all of them. A plan without webhooks answers `403` with `code: "MODULE_DISABLED"` and `module: "webhooks"`. A refused field answers `400 VALIDATION_ERROR` with `errors: [{ field, message, code }]`; the codes are `URL_REQUIRED`, `URL_TOO_LONG`, `URL_INVALID`, `URL_NOT_HTTPS`, `URL_CREDENTIALS`, `URL_NO_HOST`, `URL_LOCAL_NAME`, `URL_PRIVATE_ADDRESS`, `URL_BLOCKED_ADDRESS`, `URL_NOT_FOUND`, `EVENTS_REQUIRED`, `EVENTS_UNKNOWN`, `TOO_LONG` (description, with `max`) and `INVALID` (active).
