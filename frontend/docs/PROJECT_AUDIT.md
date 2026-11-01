# HackOS — Project Audit

**Date:** 3 September 2026
**Scope:** `frontend/` (Next.js 16, 225 files, ~51,500 lines) and `backend/` (Express + PostgreSQL, 102 files, ~10,700 lines)
**Method:** static inspection of both repositories, live measurement against `hack-os.app` and `app.hack-os.app`, contrast and layout measurement in a browser at 1400px and 375px, route enumeration against the running API.

Every finding below is tied to something measured or read, with the file path. Where a number appears, it was counted, not estimated.

---

## Executive Summary

HackOS is further along than most projects of its age. It runs real events — 213 participants, 38 teams, 855 scores are queries against the production database, not claims — and the organiser console covers a genuinely complete event lifecycle: registration, approvals, teams, submissions, weighted judging, leaderboard, results, help queue, announcements, resources. Five role portals exist and work. The marketing site, the public walkthrough and the owner console are three distinct, coherent surfaces.

The weaknesses are not in what it does. They are in three areas:

**1. Authorization has no tenant boundary.** This is the most serious finding and it is not theoretical — it is the direct cause of the problem already noticed in production: *"why do they see other hackathons?"* Any authenticated user of any role receives every event on the platform, including unpublished drafts, from `GET /api/events`; and `GET /api/events/:identifier` needs no authentication at all and returns `SELECT *`. A participant at one hackathon can enumerate every hackathon ever created. Until events belong to an owner and queries are scoped to it, the platform cannot honestly be sold to two customers at once.

**2. Secrets were committed and are still in git history.** `backend/.env` is present in commits `d70125c` and removed in `76a44ea`. The repository is private, which limits the blast radius, but the JWT signing secret and the database URL from that period remain recoverable by anyone with repository access, forever, unless rotated.

**3. There is no data layer.** 160 `apiGet` calls are spread across 109 `useEffect` hooks in 74 client components. Every page hand-rolls its own fetch, loading flag, error flag and refetch. There is no caching library, no query deduplication beyond a small in-flight map, and no server-side data fetching. This is the root cause of a family of symptoms that look like separate problems: only 20 of 40 authenticated pages have an error state, only 3 of 40 have an empty state, the same endpoints are refetched on every navigation, and first paint is always a spinner.

Everything else — visual polish, missing B2B surfaces, responsive gaps — is downstream of having built features faster than the foundations under them. That is a normal and recoverable position, but the foundations now need a deliberate pass.

**Current honest grade:** a strong vertical product with a thin platform underneath it. It would not survive a security review by an enterprise buyer, and the security page already says so about certifications — but not about this.

---

## CRITICAL Issues

### C1. Any authenticated user can read every event on the platform

**Where:** `backend/src/controllers/event.controller.js:23-30`, `backend/src/services/event.service.js:50-53`

```js
const events = req.user
  ? await eventService.getAllEvents()      // SELECT * FROM events — no filter
  : await eventService.getPublicEvents();
```

**Why it is a problem:** `getAllEvents()` applies no ownership, membership or visibility filter. A hacker registered for one event, a judge invited to one panel, a mentor — all receive every row of the `events` table, including events that are `is_published = false`, i.e. drafts nobody has announced yet.

**How it affects the user:** the customer already reported this: participants in the walkthrough and the app see hackathons that are not theirs. Commercially it is worse than a bug — it means two customers on the same instance can see each other's unannounced programmes.

**Severity:** CRITICAL.

**Fix:** introduce a scope. Minimum viable: an `event_members` view derived from `participants`, `judges`, `mentor_assignments`, `volunteers` and `events.created_by`; `getAllEvents` becomes `getEventsVisibleTo(user)`, returning everything only for platform-owner roles. The `customers`/`orders` tables added in migration `0005` give a longer-term home for real tenancy.

### C2. `GET /api/events/:identifier` is unauthenticated and returns every column

**Where:** `backend/src/routes/event.routes.js:18`, controller at `event.controller.js:49-59`, service at `event.service.js:114-117`

```js
router.get('/:identifier', eventController.getEventByIdentifier);   // no authMw
...
const result = await db.query(`SELECT *, ${DERIVED_STATUS} FROM events WHERE id = $1`, [id]);
```

**Why it is a problem:** ids are sequential integers. Anyone, signed in or not, can walk `/api/events/1`, `/api/events/2`, … and read the full row of every event — including unpublished drafts, internal descriptions, and `created_by`. A `PUBLIC_COLUMNS` list exists in the same file (`event.service.js:38`) and is deliberately narrower; this endpoint does not use it.

**How it affects the user:** competitors, participants and the public can enumerate the whole event catalogue and read drafts before announcement.

**Severity:** CRITICAL.

**Fix:** unauthenticated callers get `PUBLIC_COLUMNS` and only `is_published = true AND status <> 'archived'`; authenticated callers get the full row only when C1's scope says they may.

### C3. Secrets are in git history

**Where:** `backend` repository, `.env` present in `d70125c` ("first commit"), removed in `76a44ea`.

**Why it is a problem:** removing a file from tracking does not remove it from history. `git show d70125c:.env` still returns the JWT signing secret and the database connection string of that era. Anyone who is now or ever becomes a collaborator, and any future accidental publication of the repository, exposes them.

**How it affects the user:** a leaked JWT secret means anybody can mint a valid admin token. That is total compromise of the platform, silently.

**Severity:** CRITICAL. Mitigated only by the repository being private today.

**Fix, in order:**
1. Rotate `JWT_SECRET` now. This invalidates all sessions — do it outside an event window.
2. Rotate the database password and any SMTP and Telegram secrets from that period.
3. Optionally rewrite history (`git filter-repo`) — but rotation is what actually protects you; history rewriting is hygiene.
4. Add a pre-commit secret scan so it cannot recur.

---

## HIGH Priority Issues

### H1. `GET /api/announcements` requires no authentication

**Where:** `backend/src/routes/announcement.routes.js:8`

Announcements carry operational detail — schedule changes, room moves, judging times. The endpoint takes an arbitrary `eventId` from the query string and is not behind `authMw`. Combined with C2's id enumeration, the whole announcement history of every event is public.

**Fix:** require authentication and event membership; keep an explicitly public subset if the participant site needs one.

### H2. The organiser dashboard ships 868 KB of three.js for a background

**Where:** `frontend/src/components/ThreeBackground.tsx` (76 lines), used twice in `frontend/src/app/(dashboard)/page.tsx:251,262`

Measured: the three.js chunk is 868 KB. It draws a decorative background. The same problem existed on the marketing hero and was solved by replacing it with a 2D canvas at zero library cost (`src/components/site/EventGraph.tsx`) — the identical fix applies here.

**How it affects the user:** the first screen an organiser sees on event day, often on venue Wi-Fi, downloads most of a megabyte it does not need.

**Fix:** port `ThreeBackground` to 2D canvas, drop `three`, `@react-three/fiber`, `@react-three/drei` entirely.

### H3. No data layer: 160 fetches across 109 effects, no caching

**Measured:** 160 `apiGet` call sites, 109 `useEffect` hooks, 74 of 104 page components are `"use client"`, and `package.json` contains no React Query, SWR, Zustand, Redux or Jotai.

Each page implements its own `loading` / `error` / `data` triple by hand. `src/lib/api.ts` has a small in-flight dedupe map but no TTL cache, so navigating away and back refetches everything.

**Consequences that look like separate bugs but are this one:**
- error states missing on 20 of 40 authenticated pages
- empty states present on only 3 of 40
- repeated identical requests on every navigation
- every page begins as a spinner because nothing is fetched on the server

**Fix:** adopt one data layer (TanStack Query is the natural fit) with a shared `useApi` wrapper that gives every screen loading, error, empty and retry for free. Do it incrementally, one route group at a time.

### H4. Empty states are effectively absent

**Measured:** 3 of 40 authenticated pages contain any empty-state affordance.

A table with no rows renders as a header and nothing else. The organiser cannot tell "no participants yet" from "the request failed" from "the filter excluded everything" — the three states look identical.

**Fix:** a shared `<EmptyState>` (one already exists at `src/components/ds/primitives.tsx:458` and is used only on the site and owner console) applied across the app, with copy that distinguishes *nothing yet*, *nothing matches this filter*, and *this did not load*.

### H5. Error states are missing on half the authenticated pages

**Measured:** `LoadFailure` appears in 20 of 40 pages. The remaining 20 fail silently — a failed fetch leaves an empty array, which renders as an empty screen.

This is the class of bug already found and fixed twice in this codebase: `listEventStaff` swallowing roster failures, and the leaderboard rendering a **wrong podium with all zeros** when `scores` failed. Both were real; the same pattern remains on twenty screens.

**Fix:** the shared data layer in H3 makes this structural rather than per-page.

### H6. Four near-duplicate shells

**Measured:** `DashboardShell.tsx` 518, `HackerShell.tsx` 342, `MentorShell.tsx` 220, `VolunteerShell.tsx` 211 — 1,291 lines implementing the same sidebar, header, drawer, theme toggle and logout four times.

**How it affects the user:** they drift. A fix to the mobile drawer or the theme toggle lands in one and not the others, so the product feels different depending on which role you hold.

**Fix:** one `<AppShell>` taking `nav`, `basePath` and `variant`; the four become configuration.

### H7. Client-only rendering hurts both speed and SEO

74 of 104 page components are client components. The marketing site has no `sitemap.ts`, no `robots.ts`, and no Open Graph or Twitter metadata anywhere; only 8 of 83 pages export `metadata`.

**How it affects the user:** a B2B site that cannot be found or previewed when shared in Slack or LinkedIn loses inbound leads. `/signin` currently server-renders to an empty body because the whole form sits inside `<Suspense fallback={null}>`.

**Fix:** move the marketing pages to server components with real metadata; add `sitemap.ts`, `robots.ts`, and per-page Open Graph images; give `/signin` a non-null Suspense fallback.

---

## MEDIUM Priority Issues

| # | Issue | Where | Why it matters |
|---|---|---|---|
| M1 | Mail implemented twice | `frontend/src/lib/smtpMail.ts` and `backend/src/services/email.service.js` | SMTP credentials must exist in two deployments; templates drift |
| M2 | `smtpMail.ts` has no `server-only` guard | `frontend/src/lib/smtpMail.ts` | A future client import would try to bundle nodemailer; a build break rather than a leak, but the guard is one line |
| M3 | Non-constant-time secret comparison | `backend/src/controllers/announcement.controller.js:86` | `secret !== expected` leaks length/prefix by timing; use `crypto.timingSafeEqual` |
| M4 | Unused dependencies | `@react-three/drei`, `qrcode.react` — 0 imports | Install time, audit surface, lockfile noise |
| M5 | Files past maintainable size | `join/[eventCode]/page.tsx` 1,847; `judge/page.tsx` 1,458; `(dashboard)/analytics` 1,112; `hacker/team` 1,022; `(dashboard)/teams` 981 | Nobody can hold 1,800 lines in their head; these are where regressions will come from |
| M6 | Three 1,500-line translation files | `src/lib/i18n/{en,az,ru}.ts` | Adding a key means three edits with no check that all three happened |
| M7 | No test that runs without infrastructure | `backend/tests/e2e.test.js` — 33 tests, all fail with `fetch failed` when no server is up | There is no way to check a change before deploying it |
| M8 | Two parallel design systems | `.hs`/`.hs-night` + `components/ds/*` (site, owner console) vs ad-hoc Tailwind + `.hh-*` (the app) | The product looks like two products; see Design System below |
| M9 | Light mode still leans on literal-chasing | `globals.css` — ~42 `html.light [class*="…"]` rules | Tokenised for the big surfaces, but the override layer remains for the rest and will keep losing that race |
| M10 | Placeholder commercial data | `src/app/(site)/_plans.ts` prices; `orders.amount_minor` NULL | Published prices are a commercial commitment; these are invented and marked as such, but must be replaced before serious use |
| M11 | Contact address is a personal Gmail | `_chrome.tsx`, `contact/`, `pricing/`, `security/`, `checkout/` | `salam@hack-os.app` reads as a company; a Gmail reads as one person |

---

## LOW Priority Issues

- **L1.** `scripts/seed-api.js` points at a decommissioned Render URL — will fail confusingly for the next person who runs it.
- **L2.** A `test` event (id 41) exists on the production database and appears in listings. It should be archived, never deleted.
- **L3.** One residual contrast failure at 4.23:1 (a white count chip) on the participants screen in both themes.
- **L4.** 104 `<input>` elements against 80 `<label>`/`htmlFor` occurrences — some inputs are unlabelled for screen readers.
- **L5.** Only 24 `role=` and 44 `aria-label` attributes across 225 files; live regions are absent, so async updates are silent to assistive technology.
- **L6.** `activity_logs` table exists in the schema with no endpoint and no UI — an audit trail that records nothing.

---

## UI/UX Problems

**The three surfaces do not share a language.** The marketing site and owner console use a token system with a documented scale (`--hs-*`, `components/ds/*`). The app uses hand-written classes and literal hexes. Border radius, shadow depth, button height, badge shape and card padding all differ between them. A customer who signs in crosses a visible seam.

**Typography in the app is undersized and flat.** The site was corrected in this session (headings 32/44/48px, body 17–18px). The app still runs 11–14px through most of its interface with weak hierarchy — labels, values and captions are often within 1px of each other.

**Tables are the weakest component in the product.** The owner console has one good generic `DataTable` (search, sort, facets, column visibility, pagination, mobile cards). The app's tables are hand-built per page with none of that: no sorting on most, no column control, no saved views, and on mobile they either scroll horizontally or clip.

**Feedback after an action is inconsistent.** Some mutations toast, some silently refetch, some do neither. There is no optimistic update anywhere, so every click waits a full round trip with no indication it registered.

**Density is wrong in both directions.** The organiser dashboard hero occupies roughly a third of the first screen for a title and a button; the participants and teams tables put 8–10 fields into a 13px row.

**Iconography drifts.** Lucide is used throughout, but sizes range 9–20px within a single screen and the same concept gets different icons in different places.

---

## Missing Features (that make sense for this product)

Judged strictly against what HackOS already is — an event operations platform sold to organisations. Features that would merely make it larger are excluded.

**Tenancy and team management (highest value).** Plans sell "organiser seats" (3, 10, 25) and nothing enforces or even displays them. There is no way to invite a colleague as an organiser, see who has access, or remove them. This is the gap between a single-user tool and a B2B product.

**Roles and permissions UI.** Seven roles exist in the database (`admin`, `org_admin`, `judge`, `mentor`, `volunteer`, `hacker`, `pending`) and are enforced server-side, but there is no screen to see or change who holds what.

**Audit log.** The `activity_logs` table exists and is unused. Every enterprise security questionnaire asks for this, and the security page currently answers those questions honestly — this would let it answer one more with a yes.

**Saved views and filters.** Organisers repeat the same filters daily during an event ("pending approvals", "teams without a submission"). The `DataTable` already supports facets; persisting a named view is a small addition with high daily value.

**Billing surface.** Migration `0005` added `customers`, `customer_contacts`, `orders`, `order_status_history`, and the account portal reads them. What is missing: invoices (a document, a number, a PDF), payment capture, and seat counts tied to the plan.

**Onboarding.** A new organiser lands on an empty dashboard with no guidance. A short checklist — create your event, set judging criteria, invite judges, open registration — would convert far better than the current blank state.

**Help and support.** No in-product help, no way to reach support without leaving for e-mail.

**Integrations.** Telegram is partially wired; there is no API key management, no webhooks, no calendar export (`.ics`), no SSO — although the security page correctly states SSO is Enterprise-only and not yet built.

**Import validation.** CSV export exists; import exists for participants but without a preview-and-confirm step, so a malformed file fails after the fact rather than before.

---

## B2B Platform Improvements

The product is currently *an app that one organisation uses*. Three changes make it *a platform that many organisations buy*:

1. **Make the customer a first-class object end to end.** The tables exist; events must belong to a customer, and every query must be scoped through that ownership. This resolves C1 and C2 as a side effect, and it is the prerequisite for everything else.

2. **Make seats real.** A plan sells N organiser seats. Enforce them: an invite screen, a seat count, a clear message at the limit, and an upgrade path. This is the mechanism by which a B2B SaaS actually grows revenue within an account.

3. **Make the commercial record complete.** Orders exist; invoices, payment state and renewal dates do not. A customer who cannot see what they owe and when it renews will ask by e-mail every quarter.

Beyond those: an audit log, saved views, and a proper onboarding checklist are the three highest-value additions per hour of work.

---

## Responsive Issues

Measured at 1400px and 375px on all six marketing routes: **no contrast failures, no horizontal overflow** — the site is in good shape after this session's work.

The app was measured at 375px earlier in the project: 17 grids were missing `grid-cols-1`, `/eliminate` had unreachable columns, and touch targets were below 40px. Those were fixed. What remains untested and likely weak:

- **Tablet (768–1024px)** is the neglected breakpoint everywhere. Most layouts jump from a single mobile column to a wide desktop grid with nothing in between; at 820px the organiser tables are cramped and the sidebar takes a third of the width.
- **The app's hand-built tables** have no mobile card treatment (the owner console's `DataTable` does — that pattern should be ported).
- **The judging screen** (`judge/page.tsx`, 1,458 lines) is the most complex layout in the product and the most likely to break on a tablet, which is the device judges actually use.
- **Landscape phone** is untested; the organiser header alone is likely to consume most of a 375×812 landscape viewport.

---

## Functional Issues

- **F1.** Half the authenticated pages have no error state (H5) — a failed request renders as empty content, which the user reads as "there is nothing here".
- **F2.** No optimistic updates and inconsistent toasts, so many actions give no immediate feedback.
- **F3.** `/signin` server-renders empty because of `<Suspense fallback={null}>`; on a slow connection it is a blank page until hydration.
- **F4.** The account portal will show an empty orders list until `customers`/`orders` rows exist — correct behaviour, but indistinguishable from a failure without an empty state that says so.
- **F5.** Seat limits on plans are advertised and unenforced — a feature that appears implemented and is not.
- **F6.** `scripts/seed-api.js` targets a dead host (L1).
- **F7.** The backend test suite (33 tests) cannot run without a live server and database, so there is no pre-deployment check of any kind.

---

## Code Quality Issues

**Architecture.** The frontend is one large client application wearing a server framework. Next.js 16's server components, streaming and caching are almost unused; the app fetches everything after hydration. This is the single biggest structural decision to revisit.

**Duplication.** Four shells (1,291 lines, H6). Mail in two places (M1). Every table re-implemented per page while a good generic one sits in `components/ds/DataTable.tsx`.

**File size.** Five files over 950 lines (M5). `join/[eventCode]/page.tsx` at 1,847 lines contains registration, team creation, invitation acceptance and login in one component.

**Hardcoded values.** Colour literals were largely tokenised this session (868 usages across 75 files), but plan limits, role lists, status strings and event phase thresholds are still duplicated between frontend and backend with no shared source.

**Positive notes, because they are real:** the backend is well-organised (routes → controllers → services, consistent response envelope, Zod validation on the newer endpoints); `src/lib/api.ts` correctly centralises the response envelope and in-flight dedupe; the migration runner is sound (advisory lock, idempotent, ordered); and the codebase carries unusually good explanatory comments where past bugs were fixed.

---

## Performance Issues

| Issue | Measured | Fix |
|---|---|---|
| three.js on the organiser dashboard | 868 KB chunk | Port to 2D canvas (H2) |
| recharts loaded in two chunks | 436 KB × 2 | Lazy-load per chart; consider a lighter library for sparklines |
| No caching | 160 fetches, no TTL cache | Data layer (H3) |
| No server rendering of data | 74/104 client components | Move read-only screens to server components |
| Repeated identical requests | Every navigation refetches | Same as caching |
| No image optimisation strategy | `<img>` used for the logo in `_chrome.tsx` with an eslint-disable | Use `next/image` or accept and document |

---

## Security Issues

Ranked. **Do not treat the private-repository status as protection** — it limits exposure, it does not remove it.

1. **C3 — secrets in git history.** Rotate `JWT_SECRET`, the database password, SMTP and Telegram secrets.
2. **C1/C2 — missing tenant scoping and an unauthenticated full-row event endpoint.**
3. **H1 — unauthenticated announcements.**
4. **M3 — timing-unsafe secret comparison** in the Telegram webhook.
5. **The owner console gate is a door, not a lock.** `frontend/src/app/(console)/workspace/_gate.tsx` checks an e-mail allow-list *client-side*. The file says so in its own comments. The backend has no platform-owner role, so any `admin` account can call `/api/customers` and `/api/orders` directly. **Add a `superadmin` role server-side.**
6. **`EntitlementGate` fails open by design** (`src/components/EntitlementGate.tsx`) — correct for availability, but it means the paywall is advisory until enforced in the API.
7. **No `server-only` guard** on `smtpMail.ts` (M2).
8. **Positive:** passwords hashed; reset tokens hashed, single-use, one-hour expiry; HTTP-only signed cookies; HSTS and a sane header set; rate limiting on `/api` globally and tighter on auth; SQL is parameterised throughout — no string-built queries found.

---

## Design System Improvements

Two systems exist. The target is one, adopted by all three surfaces.

**Keep and extend** `frontend/src/components/ds/` — it is already the better system: `primitives.tsx` (Button, Card, Badge, Avatar, Stat, Tabs, Progress, Tooltip, Skeleton, EmptyState, ErrorState), `DataTable.tsx`, `overlays.tsx` (Modal, Drawer, Confirm, Toast), `charts.tsx` (validated 8-slot categorical palette), `board.tsx`.

**Token layers to unify:**

| Layer | Today | Target |
|---|---|---|
| Site | `.hs` + `.hs-night` | keep |
| Owner console | `.hs` (light) | keep |
| App | `--app-*` (added this session) + ~42 `html.light` override rules | migrate to the same token names as `.hs`, retire the override layer |

**Specific gaps to close:**
- **Spacing:** no scale is declared; values range 2–14 in Tailwind units chosen per component. Adopt a 4pt scale and document the three container widths in use.
- **Radius:** `--hs-radius: 10px` / `--hs-radius-sm: 7px` on the site; the app uses `rounded-lg`, `rounded-xl`, `rounded-2xl` and `rounded-full` interchangeably. Pick three.
- **Shadow:** the site uses one; the app uses five. Define elevation 0/1/2 and nothing else.
- **Type scale:** the site now has one (12/13/15/17/32/44/48). The app has none — define the same scale and apply it.
- **Buttons:** the app has no button primitive at all. Every button is bespoke Tailwind. This is the highest-leverage single component to introduce.
- **Status colour:** now tokenised (`--app-ok/warn/danger/violet`) with light and dark steps that both clear 4.5:1. Extend the same treatment to badges and chips, which still carry literals in places.

---

## Recommended New Features, prioritised by value per hour

| Priority | Feature | Why |
|---|---|---|
| 1 | Tenant scoping (events belong to a customer) | Fixes C1/C2; prerequisite for selling to a second customer |
| 2 | `superadmin` role in the backend | Turns the owner console's door into a lock |
| 3 | Organiser seats + invite flow | The plans already sell it; nothing enforces it |
| 4 | Shared data layer + universal loading/error/empty | Fixes H3/H4/H5 structurally rather than 40 times |
| 5 | Audit log UI over `activity_logs` | Table exists; answers a standing enterprise question |
| 6 | Invoices on orders | Completes the commercial record started in migration 0005 |
| 7 | Saved views on tables | Daily time saved during an event |
| 8 | Onboarding checklist | Converts new organisers who currently land on a blank screen |
| 9 | `.ics` calendar export | Small, and asked for by every event organiser |
| 10 | SSO (Enterprise) | Already promised as Enterprise-only on the security page |

---

## Implementation Roadmap

### Phase 1 — Critical fixes (do these before anything else)
1. Rotate `JWT_SECRET`, database password, SMTP and Telegram secrets (**C3**). Schedule outside an event window — it signs everyone out.
2. Scope `GET /api/events` to events the caller can see; add a platform-owner role (**C1**).
3. Make `GET /api/events/:identifier` return `PUBLIC_COLUMNS` for unauthenticated callers and published events only (**C2**).
4. Put `GET /api/announcements` behind authentication and membership (**H1**).
5. Replace the timing-unsafe comparison in the Telegram webhook (**M3**).

**Done when:** a signed-in hacker from event A receives only their own events, and an anonymous request for an unpublished event id returns 404.

### Phase 2 — UX/UI upgrade
6. Introduce a shared data layer; give every screen loading, error, empty and retry from one place (**H3, H4, H5**).
7. Collapse four shells into one configurable `AppShell` (**H6**).
8. Port the owner console's `DataTable` into the app, replacing hand-built tables.
9. Apply the site's type scale and the `ds/` primitives to the app; introduce a Button primitive.
10. Fix the tablet breakpoint across the app, starting with the judging screen.

**Done when:** every authenticated screen distinguishes *loading*, *empty*, *filtered to nothing* and *failed*, and no page renders an empty table on a failed request.

### Phase 3 — Product expansion
11. ~~Tenant model: events belong to customers; seats enforced; organiser invite flow.~~
    **Done.** `events.customer_id` (migration 0007, additive and backfilled from
    `orders`), seat limits on `customers`, hashed single-use `customer_invites`,
    `/account/team`, `/invite/[token]`, and the owner's Customers console.
    Customer administrators are now scoped, with `includeUnassigned` keeping
    unassigned events visible so nothing was taken away on the day it shipped.
12. Audit log UI over `activity_logs`.
13. Invoices and payment state on orders.
14. Saved views, onboarding checklist, `.ics` export.

### Phase 4 — Performance and architecture
15. Replace `ThreeBackground` with 2D canvas; remove `three`, `@react-three/*`, `qrcode.react` (**H2, M4**).
16. Move read-only screens to server components; add caching.
17. Split the five oversized files (**M5**).
18. Consolidate mail into the backend (**M1**).
19. Add tests that run without infrastructure — unit tests for the services and a mocked-API test for the critical flows (**M7**).

### Phase 5 — Final polish
20. SEO: `sitemap.ts`, `robots.ts`, Open Graph per route, non-null Suspense fallbacks (**H7**).
21. Accessibility pass: label every input, add live regions for async updates, audit focus order (**L4, L5**).
22. Retire the `html.light` override layer in favour of tokens (**M9**).
23. Replace placeholder prices and the Gmail contact address (**M10, M11**).
24. Archive the `test` event; fix `seed-api.js` (**L1, L2**).
25. Micro-interactions: optimistic updates on the common mutations, consistent toasts, and the one residual 4.23:1 chip (**L3**).

---

## What is genuinely good, and should not be "improved"

Worth stating so a future pass does not undo it:

- **The judging model.** Weighted per-criterion scoring with coverage tracking, and a leaderboard that refuses to show a podium when scores fail to load. That refusal was added deliberately after a real bug and must survive any refactor.
- **The honesty of the security page.** It states what the platform does *not* have — no SOC 2, no ISO 27001, no external pen test, no 24/7 rota. Keep that.
- **The `/demo` walkthrough architecture.** It re-exports the real screens against sample data rather than duplicating them, so the demo cannot drift from the product.
- **`number | null` counting in the owner console.** A failed read shows "—" and names itself instead of summing to a smaller number that looks real. Apply this idea more widely; do not remove it.
- **The migration runner.** Idempotent, ordered, advisory-locked.
