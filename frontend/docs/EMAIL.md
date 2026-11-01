# E-mail

The web app does not send e-mail. Every message goes out from the API
(`hack-os-backend`), which picks Resend, Brevo or SMTP from its environment.
Setup, DNS records and the list of e-mails are in `docs/EMAIL.md` in the
backend repository.

What the web app does:

| Screen | Call | Result |
| --- | --- | --- |
| Settings → E-mail delivery | `GET /api/mail/status`, `POST /api/mail/test` | Shows the provider and sender; sends a test to your own address |
| Judges / Mentors → send invite | `POST /api/mail/staff-invite` `{ to, eventId }` | Re-sends the event invite to an address that already has a pending invite |
| Account team → invite | `POST /api/account/team/invites` | Invite e-mail, or the accept link back when mail is off |
| Forgot password | `POST /api/auth/forgot-password` | Reset link by e-mail |

Registration, approval and submission e-mails are sent by the API as a side
effect of those actions; the web app does nothing extra for them.
