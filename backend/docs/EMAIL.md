# E-mail

Every e-mail HackOS sends goes out from this API through `src/services/mailer.js`.
The web app sends none itself.

## What is sent

| When | To | Function | Switch (default) |
| --- | --- | --- | --- |
| A hacker registers for an event | the hacker | `sendRegistrationReceivedEmail` — "received" (pending) or "confirmed" (invited) | `SEND_EMAIL_ON_REGISTRATION` (on) |
| An organiser approves a hacker | the hacker | `sendParticipantApprovedEmail` | `SEND_EMAIL_ON_PARTICIPANT_APPROVED` (on) |
| The team lead submits the project | every team member | `sendSubmissionReceivedEmail` | `SEND_EMAIL_ON_SUBMISSION` (on) |
| An organiser adds a judge / mentor / volunteer invite | the invitee | `sendEventInviteEmail` | `SEND_EMAIL_ON_EVENT_INVITE` (off) |
| Judges / Mentors → "send invite" | the invitee (must hold a pending invite) | `sendEventInviteEmail` via `POST /api/mail/staff-invite` | always |
| Account team → invite a colleague | the colleague | `sendCustomerInviteEmail` | always |
| Forgot password | the account holder | `sendPasswordResetEmail` | always |
| A buyer places an order at checkout | the buyer (receipt) and the sales inbox (alert) | `sendOrderPlacedEmail`, `sendSalesAlert` | always |
| Someone sends the website contact form (`POST /api/leads`) | the sales inbox, Reply-To the visitor | `sendSalesAlert` | always |
| Settings → E-mail delivery → test | the organiser who clicked | `sendTestEmail` via `POST /api/mail/test` | always |

Recipients and links are built on the server. No endpoint accepts an arbitrary
recipient, subject, body or link from a request.

A mail that fails never undoes the action that triggered it. The failure is
logged (`[mail] … refused …`) and, where a person is waiting on it (test send,
staff invite, account invite), returned to them.

## Providers

| Provider | Variables | Notes |
| --- | --- | --- |
| Resend (recommended) | `RESEND_API_KEY` | HTTPS API. Free tier at the time of writing: 3,000 mails/month, 100/day. |
| Brevo | `BREVO_API_KEY` | HTTPS API. Free tier at the time of writing: 300 mails/day. |
| SMTP | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_PORT`, `SMTP_SECURE` | Render's free plan blocks outbound SMTP ports. |

Without `MAIL_PROVIDER` the first configured one in that order is used. With it,
only that one — a named provider without its key is reported as a problem, not
silently replaced.

Sales inbox (order and contact-form alerts): `SALES_NOTIFY_EMAIL`, falling
back to `MAIL_REPLY_TO`, then `BOOTSTRAP_SUPERADMIN_EMAIL`. The contact form
never mails the address a visitor typed — only this inbox.

Sender: `MAIL_FROM_EMAIL` (falls back to `INVITE_FROM_EMAIL`, `SMTP_FROM`,
`SMTP_USER`), `MAIL_FROM_NAME` (default `HackOS`), optional `MAIL_REPLY_TO`.

With no provider, development prints each message to the console (so password
reset can be followed locally) and production refuses to pretend: the send
fails and `GET /api/mail/status` says why.

## Production setup with Resend

1. Create an account at resend.com.
2. **Domains → Add domain** → `hack-os.app`. Resend shows DNS records: an MX
   and a TXT (SPF) on a `send` subdomain and a TXT (DKIM) `resend._domainkey`.
3. Add those records where `hack-os.app`'s DNS is managed (the registrar, or
   Vercel → Domains if Vercel serves the DNS). Add a DMARC record as well:
   `TXT _dmarc` → `v=DMARC1; p=none; rua=mailto:<an inbox you read>`.
4. Wait until Resend shows the domain as **Verified**.
5. **API Keys → Create** with "Sending access" only.
6. In Render → hackos-api → Environment set:
   - `RESEND_API_KEY` = the key (never commit it or paste it in chat)
   - `MAIL_FROM_EMAIL` = `no-reply@hack-os.app`
   - `MAIL_FROM_NAME` = `HackOS`
   - `MAIL_REPLY_TO` = an inbox someone reads (optional)
   - `FRONTEND_URL` = `https://hack-os.app` (links in every e-mail start here)
   - `FRONTEND_URLS` = every host the app is served from, comma-separated
7. Save; Render redeploys.
8. Sign in as an organiser → Settings → E-mail delivery should read **Ready /
   resend / no-reply@hack-os.app**. Press **Send test e-mail** and check it
   arrives in the inbox, not spam.

Then walk the real flows once: register a hacker, approve them, submit a
project, use "Forgot password".

## Endpoints

- `GET  /api/mail/status` (organiser) → `{ configured, provider, fromEmail, fromName, replyTo, problem }`. Never includes a key.
- `POST /api/mail/test` (organiser, 5/minute) → sends to the caller's own address.
- `POST /api/mail/staff-invite` (organiser) `{ to, eventId }` → 404 unless `to`
  holds a pending invite on an event the caller may manage.

## Tests

`node --test tests/mailer.test.js` covers provider choice, request shape for
Resend and Brevo, refusal and network errors, production-without-provider,
recipient validation and template escaping, with no network access.
