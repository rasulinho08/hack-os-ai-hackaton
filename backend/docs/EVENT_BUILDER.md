# Event builder, public page and registration

How an event is made, published and filled. Organiser routes need a session
of an organiser of the event; the rest is public.

## Lifecycle

1. **Draft** — `POST /api/events/drafts { name, template, language, timezone }`.
   Templates: `blank`, `hackathon24`, `ideathon`, `university`. A template
   fills dates (relative to today, in the event's time zone), team sizes,
   submission requirements, judging criteria, the first three prizes, the
   registration form and house rules. A draft is not public and costs
   nothing from the plan.
2. **Building** — `GET /api/events/:id/builder` returns everything at once
   (event, form, tracks, prizes, sponsors, criteria, staff, resources, plan,
   modules, limits, checklist, capacity, share-link counts).
   `PATCH /api/events/:id/builder` saves any subset of fields (the wizard
   autosaves one field at a time). Lists are saved whole:
   `PUT /api/events/:id/builder/{tracks|prizes|sponsors|criteria|form}`
   with `{ items: [...] }` — rows with `id` are updated, rows without are
   added (send a `cid`; the answer maps it to the new id), rows left out are
   removed. Something still in use is not removed: a track with prizes, a
   criterion judges already scored, a question somebody answered (archived
   instead).
3. **Checklist** — every save answers the publish checklist: `error` items
   block publishing, `warning` items do not. Each item names its builder
   section and a `code` the web app translates.
4. **Publish** — `POST /api/events/:id/builder/publish`: refused with 422
   `NOT_READY` while the checklist has errors; takes one event from the
   organisation's plan (402 `NO_EVENT_CREDIT` when none is left, 422
   `EVENT_OUTSIDE_PLAN` when the event starts after the plan ends). Publishing
   again after an unpublish takes nothing more. Updates (`PUT /api/events/:id`,
   builder `PATCH`) can never publish or change the status.
5. **Unpublish** — `POST /api/events/:id/builder/unpublish` hides the page;
   the plan's event stays with it.

The plan decides parts of the builder: branding (logo, banner, colour) is
Business and up; own registration questions, presentations, mentors,
volunteers, resources, certificates and automatic announcements are
Professional and up. Such a save is refused with 403 `MODULE_DISABLED`.

## Public page

`GET /api/public/events/:slug` (the registration code works too): published,
non-archived events only. Public columns, tracks, prizes, sponsors, judging
criteria, what a submission asks for, the registration state and capacity,
and the form. The online meeting link and every internal setting stay out.

## Registration

`POST /api/public/events/:slug/register`

```json
{
  "account": { "fullName": "…", "email": "…", "password": "…" },
  "answers": { "phone": "+994…", "age": 21, "q_1a2b3c4d": "Linux", "cv": { "fileId": "…", "claimToken": "…" } },
  "entry": { "type": "solo" | "lead" | "member", "teamName": "…", "teamCode": "…", "trackId": 3 },
  "accept": { "rules": true, "coc": true },
  "ref": "instagram"
}
```

`account` only for someone without a session; a new account is signed in by
the response. One transaction does everything: account, participant,
answers, team. Rules, from the event: published and the window open (an
organiser's personal invite gets through a closed window); the entry type
allowed by the registration mode; required answers and their types;
eligibility (age, country, city, students only) and the rules / code of
conduct confirmations; capacity — the lower of the organiser's limit and the
plan's — with the waitlist when full (409 `EVENT_FULL` when the waitlist is
off); approval — `auto` approves while there is room, otherwise pending.
Someone on the waitlist gets no team until a place opens.

The old `POST /api/auth/register` with an event follows the same window,
mode and capacity rules, and sends people to the event page when the event
asks questions (`REGISTRATION_FORM_REQUIRED`) or is for teams only
(`TEAM_REQUIRED`). The web app's `/join/<CODE>` (and team invites
`/join/<CODE>?teamCode=…`) redirect to `/e/<slug>/register`.

## What the settings change

Every builder section that is not marked "with the … update" acts:

| Setting | Where it acts |
| --- | --- |
| Team deadline | Team changes (create, join, invites, registration as lead or member) close at `team_deadline`, or at the start when there is none (`TEAM_FORMATION_CLOSED`). |
| Online link | `online_url` is sent only to the event's organisers and staff and to admitted participants (`GET /api/events/:id`, `/active`, lists); never on the public page. The participant dashboard shows it. |
| Mentors → help queue | `POST /api/tickets` refuses when tickets are off (`TICKETS_DISABLED`) and when the team (or a person without one) already has `maxOpenTicketsPerTeam` open or in-progress requests (`TICKET_LIMIT`). |
| Submissions → links and texts | Each of repository, demo, slides, video, description and technologies is required, optional or off (`GET /api/submissions/rules`). Off fields are not stored; a missing required one is a 400 with `errors[].field`. Repositories are on GitHub, GitLab, Bitbucket or Codeberg. |
| Submissions → files | When on, the team lead uploads `purpose=submission` files (the event's types, up to its size, at most 5) while submissions are open, and lists them in `fileIds` on the submission. Readable by the team, the event's judges, mentors and organisers. Files dropped from the list are deleted; unlisted uploads are removed after a day. |
| Presentation day | Generated slots are talk + Q&A minutes long, ordered by submission time or shuffled; with a demo day, each slot's time follows the one before (and moves when a slot is lengthened or reordered). `GET /api/events/:id/presentations/settings` gives the timer its talk, Q&A and warning times. |
| Messages → e-mail | Event e-mails (registration, approval, submission receipt, staff invitations) are signed with the sender name (default: the event's name) and reply to the reply-to address. The sending address stays the platform's. |

Not yet acting, and labelled so in the builder: blind judging, judge
assignment, results visibility, mentors' online status, automatic
announcements, certificates.

## Files

`POST /api/files?purpose=<p>&eventId=<id>` with the file as the body and its
name in `X-File-Name`. Purposes: `event_logo`, `event_banner`,
`sponsor_logo` (public, images, 1–3 MB), `signature` (private image),
`registration` (private; PDF, DOCX, PNG, JPEG up to 5 MB), `submission`
(private; the event's types among PDF, PPTX, DOCX, ZIP and images, up to its
size, at most 10 MB). The type comes from the file's bytes. Registration
uploads work without a session on an open event and return a `claimToken`,
used in the answers; unclaimed ones are removed after a day. Private files
are readable by their uploader and the event's organisers (project files
also by the team, judges and mentors). Limits: the plan's storage and
`STORAGE_DB_MAX_MB`. The web app keeps `/api/files` out of its middleware so
large uploads are not cut short.

## Universities

`GET /api/universities?q=&country=` — the official list of the Ministry of
Science and Education of Azerbaijan (edu.gov.az, all four categories,
branches included) first, searchable by Azerbaijani name, English name and
abbreviation; then the open university-domains-list dataset (MIT licence,
`data/universities/LICENSE-world.txt`).
