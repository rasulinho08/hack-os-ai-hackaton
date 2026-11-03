# HackOS AI

HackOS is an operations platform for hackathon organisers: registration, teams,
mentors, judging, pricing and invoicing. This repository is my entry for the
Meta Global AI Developer Hackathon (Startup track).

## Pre-existing work and what is new

HackOS existed before this hackathon: the API (`backend/`) and the web app
(`frontend/`) were developed earlier in separate repositories and are imported
here as the starting point (the first two commits). Everything after those two
commits is hackathon work:

- Meta open-weights models served through Fireworks, used for judging
  assistance (summaries and pre-scores of submissions against an organiser's
  criteria), participant Q&A and generated event reports.

## Layout

```
backend/    Express + PostgreSQL API
frontend/   Next.js web app
render.yaml Render blueprint for the API (rootDir: backend)
```

## Running locally

See `backend/README.md` and `frontend/README.md`. Deploying (Supabase, Render, Vercel): `DEPLOY.md`.
