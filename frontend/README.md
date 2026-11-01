# HackOS — web app

Next.js 16 (App Router) front end for the HackOS hackathon platform:
organiser dashboard (`/`), hacker portal (`/hacker`), mentor (`/mentor`),
judge (`/judge`) and volunteer (`/volunteer`) zones.

## Run locally

```bash
npm ci
cp .env.example .env.local        # NEXT_PUBLIC_API_URL=http://localhost:5000
npm run dev                       # http://localhost:3000
```

All `/api/*` calls go to the same origin; `next.config.ts` rewrites the ones
not handled by a local route handler to the Express API
(`NEXT_PUBLIC_API_URL`). The middleware (`middleware.ts`) validates the
session against `GET /api/auth/me` on the same origin, so both must point at
the same API.

Route handlers under `src/app/api/*` that run inside Next itself need their
own env (SMTP_*, TELEGRAM_*, OPENROUTER_API_KEY for the event-wizard chat) — see `.env.example`.

## Scripts

- `npm run dev` / `npm run build` / `npm start`
- `npm run lint` — ESLint (next/core-web-vitals + typescript)
- `npm test` — vitest unit tests (`src/**/*.test.ts`)
- `npx tsc --noEmit` — type check

## Docker

`Dockerfile` produces a standalone production image (`output: "standalone"`).
Build arg `NEXT_PUBLIC_API_URL` must be the API origin as seen from the Next
server (inside docker compose: `http://api:5000`). There is no compose file
in this repository; wire the image to the API container yourself.

## Production (Vercel)

One project serves both hosts. Set these environment variables (NEXT_PUBLIC_*
values are inlined at build time, so change them and redeploy):

| variable | value |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | the API origin (the build fails without it) |
| `NEXT_PUBLIC_MARKETING_HOSTS` | `hack-os.app,www.hack-os.app` — "/" renders the landing page on these hosts |
| `NEXT_PUBLIC_APP_ORIGIN` | `https://app.hack-os.app` — cross-host links into the product; needs `COOKIE_DOMAIN=.hack-os.app` on the API so one sign-in covers both hosts |
| `NEXT_PUBLIC_SITE_URL` | `https://www.hack-os.app` — canonical URLs, share tags, sitemap |
| `SMTP_*`, `TELEGRAM_*`, `OPENROUTER_*` | optional, see `.env.example` |

Never set `DOCKER_BUILD` on Vercel.
