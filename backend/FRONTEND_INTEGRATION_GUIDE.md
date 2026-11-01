# Frontend Integration Guide - Hackathon Management System

## Backend URL

```
Production: https://hackatonhbtnback-end-1.onrender.com
Local:      http://localhost:5000
```

## Qlobal Setup

### Fetch Config

Bütün API sorğularında `credentials: 'include'` OLMALIDIR (cookie auth üçün):

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://hackatonhbtnback-end-1.onrender.com';

async function api(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message);
  return data.data;
}
```

### .env.local (frontend)

```
NEXT_PUBLIC_API_URL=https://hackatonhbtnback-end-1.onrender.com
```

## Cavab Formatı

Bütün endpoint-lər eyni format qaytarır:

```json
// Uğurlu
{ "success": true, "data": { ... } }

// Xəta
{ "success": false, "message": "Error description" }
```

## Roller

| Role | Təsvir |
|------|--------|
| `hacker` | İştirakçı (default) |
| `mentor` | Mentor |
| `judge` | Hakim |
| `admin` | Administrator (tam səlahiyyət) |

---

## 1. AUTHENTICATION

**localStorage/cookie-dən oxunan fake auth SİLİNMƏLİDİR.** Backend HTTP-only cookie (`access_token`) istifadə edir. Cookie avtomatik göndərilir, frontend-dən əl ilə idarə etmək lazım deyil.

### POST /api/auth/register

İctimai qeydiyyatda `body.role` **nəzərə alınmır** (həmişə server təyin edir). Dəvət məntiqi: **`eventId`** (rəqəm, üstünlük) və ya **`eventCode`** (məs. `HACK2026`) — hədəf event tapılır; `event_invites` cədvəlində bu email üçün gözləyən sətir varsa → **rol dəvətdən** (mentor/judge/hacker), dəvət `used_at` ilə bağlanır və mentor/judge/participants uyğun cədvəllərə yazılır. **Dəvət yoxdursa** → rol **hacker** (403 xətası yoxdur). `eventId`/`eventCode` yanlışdırsa (event yoxdur) → 404.

```ts
// Request
await api('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({
    fullName: "John Doe",
    email: "john@example.com",
    password: "123456",
    eventId: 1,                  // optional — frontend event id (string də qəbul olunur)
    // eventCode: "HACK2026",     // optional — eventId yoxdursa kod ilə
    githubLink: "https://github.com/john"  // optional, valid URL or ""
  })
});

// Response 201
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "id": 1,
    "full_name": "John Doe",
    "email": "john@example.com",
    "role": "hacker",
    "github_link": "https://github.com/john"
  }
}
```

### POST /api/auth/login

Login cookie set edir. Bundan sonra bütün sorğular avtomatik autentifikasiya olunur.

```ts
await api('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({
    email: "john@example.com",
    password: "123456"
  })
});

// Response 200 + access_token cookie set olunur
{
  "success": true,
  "message": "Logged in successfully",
  "data": {
    "id": 1,
    "fullName": "John Doe",
    "email": "john@example.com",
    "role": "hacker",
    "githubLink": "https://github.com/john"
  }
}
```

### POST /api/auth/logout

```ts
await api('/api/auth/logout', { method: 'POST' });
// Cookie silinir
```

### GET /api/auth/me

Cari istifadəçinin profilini qaytarır. Login olub-olmadığını yoxlamaq üçün istifadə edin.

```ts
const user = await api('/api/auth/me');

// Response 200
{
  "id": 1,
  "full_name": "John Doe",
  "email": "john@example.com",
  "role": "hacker",
  "github_link": "..."
}
```

**Frontend dəyişiklik:** `LoginClient.tsx`-dəki `localStorage.setItem('user', ...)`, `document.cookie = ...` əvəzinə `POST /api/auth/login` çağırın. `middleware.ts`-da cookie yoxlamasını `GET /api/auth/me` ilə əvəz edin.

---

## 2. USERS (Admin Panel)

### GET /api/users?role=hacker
Auth: admin, mentor, judge

```ts
const users = await api('/api/users?role=hacker');
// role parametri optional: "hacker" | "mentor" | "judge" | "admin"
```

### GET /api/users/:id
Auth: any logged-in user

### PATCH /api/users/:id
Auth: any logged-in user

```ts
await api('/api/users/1', {
  method: 'PATCH',
  body: JSON.stringify({
    fullName: "Updated Name",
    avatar: "https://...",
    githubLink: "https://github.com/..."
  })
});
```

### DELETE /api/users/:id
Auth: admin only

### PATCH /api/users/:id/role
Auth: admin only

```ts
await api('/api/users/1/role', {
  method: 'PATCH',
  body: JSON.stringify({ role: "mentor" })
});
```

---

## 3. EVENTS

### GET /api/events
Public. Bütün event-lərin siyahısı.

### GET /api/events/active
Public. Hal-hazırda aktiv event.

### GET /api/events/:code
Public. Event code ilə axtarış (məs: "HACK2026").

### POST /api/events
Auth: admin

```ts
await api('/api/events', {
  method: 'POST',
  body: JSON.stringify({
    eventCode: "HACK2026",
    name: "Spring Hackathon 2026",
    description: "Annual hackathon event",
    startDate: "2026-04-01T09:00:00Z",
    endDate: "2026-04-02T18:00:00Z",
    teamSizeLimit: 4,
    // Optional: persist judging rubric immediately (same shape as PUT …/judging/criteria).
    criteria: [
      { name: "Innovation", maxScore: 10, weight: 1 },
      { name: "Technical execution", maxScore: 10, weight: 1 },
    ],
  })
});
```

`judging: { criteria: [...] }` is also accepted as an alias for `criteria`.

### PUT /api/events/:id
Auth: admin

```ts
await api('/api/events/1', {
  method: 'PUT',
  body: JSON.stringify({
    name: "Updated Name",
    description: "...",
    start_date: "2026-04-01T09:00:00Z",
    end_date: "2026-04-02T18:00:00Z",
    team_size_limit: 5,
    allow_team_formation: true,
    require_submission: true,
    allow_late_submissions: false
  })
});
```

### DELETE /api/events/:id
Auth: admin

### POST /api/events/:id/publish
Auth: admin. Event-i publish edir (is_published=true, status='upcoming').

### POST /api/events/:id/archive
Auth: admin. Event-i arxivləyir (status='archived').

### GET /api/events/:id/analytics
Auth: admin

```json
// Response
{
  "participants": 45,
  "teams": 12,
  "submissions": 10
}
```

---

## 4. TEAMS

### POST /api/teams
Auth: hacker

```ts
await api('/api/teams', {
  method: 'POST',
  body: JSON.stringify({
    eventId: 1,
    name: "Team Alpha"
  })
});

// Response: team object with join_code
{
  "id": 1,
  "name": "Team Alpha",
  "event_id": 1,
  "join_code": "a1b2c3d4",
  ...
}
```

### POST /api/teams/join
Auth: hacker

```ts
await api('/api/teams/join', {
  method: 'POST',
  body: JSON.stringify({ joinCode: "a1b2c3d4" })
});
```

### GET /api/teams/mine
Auth: hacker. Öz komandanı gör.

### GET /api/teams
Auth: admin. Bütün komandalar. Optional: `?eventId=1`

### GET /api/teams/:id
Auth: any logged-in

### PUT /api/teams/:id
Auth: any logged-in

### DELETE /api/teams/:id
Auth: admin

### GET /api/teams/:id/members
Auth: any logged-in

### POST /api/teams/:id/members
Auth: any logged-in

```ts
await api('/api/teams/1/members', {
  method: 'POST',
  body: JSON.stringify({ userId: 5 })
});
```

### DELETE /api/teams/:id/members/:userId
Auth: any logged-in

---

## 5. SUBMISSIONS

### POST /api/submissions
Auth: hacker (must be in a team). Upsert: eyni team+event üçün yenidən submit etmək update edir.

```ts
await api('/api/submissions', {
  method: 'POST',
  body: JSON.stringify({
    projectName: "My Awesome App",
    description: "A hackathon project",
    repoLink: "https://github.com/user/repo",
    demoLink: "https://demo.example.com"
  })
});
```

### GET /api/submissions
Auth: judge, admin. Optional: `?eventId=1`

### GET /api/submissions/:id
Auth: any logged-in

### PUT /api/submissions/:id
Auth: hacker

### DELETE /api/submissions/:id
Auth: admin

---

## 6. HELP QUEUE / TICKETS

### POST /api/tickets
Auth: hacker (must be in a team)

```ts
await api('/api/tickets', {
  method: 'POST',
  body: JSON.stringify({
    topic: "Deployment issue",
    description: "Cannot deploy to Vercel",
    tableLocation: "A-12"
  })
});
```

### GET /api/tickets
Auth: mentor, admin. Optional: `?eventId=1&status=open`

### PATCH /api/tickets/:id/claim
Auth: mentor, admin. Mentor tiketi götürür (status -> in-progress).

### PATCH /api/tickets/:id/resolve
Auth: mentor, admin. Tiket həll olunur (status -> resolved).

### DELETE /api/tickets/:id
Auth: admin

---

## 7. ANNOUNCEMENTS

### GET /api/announcements
Public. Optional: `?eventId=1`

### POST /api/announcements
Auth: admin

```ts
await api('/api/announcements', {
  method: 'POST',
  body: JSON.stringify({
    eventId: 1,
    title: "Judging starts at 6PM",
    content: "Please submit your projects before...",
    type: "info",       // "info" | "warning" | "urgent"
    priority: "normal"  // "normal" | "high"
  })
});
```

### PUT /api/announcements/:id
Auth: admin

### DELETE /api/announcements/:id
Auth: admin

---

## 8. PARTICIPANTS (Event-scoped)

Base: `/api/events/:eventId/participants`

### GET /api/events/:eventId/participants
Auth: admin. Optional: `?status=approved`

### GET /api/events/:eventId/participants/:id
Auth: admin

### POST /api/events/:eventId/participants
Auth: admin

```ts
await api('/api/events/1/participants', {
  method: 'POST',
  body: JSON.stringify({ userId: 5 })
});
```

### PATCH /api/events/:eventId/participants/:id
Auth: admin. Status dəyişmək.

```ts
await api('/api/events/1/participants/3', {
  method: 'PATCH',
  body: JSON.stringify({ status: "approved" })
  // status: "pending" | "approved" | "rejected" | "eliminated"
});
```

### DELETE /api/events/:eventId/participants/:id
Auth: admin

### POST /api/events/:eventId/participants/:id/eliminate
Auth: admin

---

## 9. PRESENTATIONS (Event-scoped)

Base: `/api/events/:eventId/presentations`

### GET /api/events/:eventId/presentations
Auth: any logged-in

### POST /api/events/:eventId/presentations
Auth: admin

```ts
await api('/api/events/1/presentations', {
  method: 'POST',
  body: JSON.stringify({
    submissionId: 1,
    teamId: 1,
    scheduledAt: "2026-04-02T14:00:00Z",
    duration: 10,
    presentationOrder: 1
  })
});
```

### PATCH /api/events/:eventId/presentations/:id
Auth: admin

### DELETE /api/events/:eventId/presentations/:id
Auth: admin

### PUT /api/events/:eventId/presentations/reorder
Auth: admin

```ts
await api('/api/events/1/presentations/reorder', {
  method: 'PUT',
  body: JSON.stringify({
    order: [
      { id: 3, order: 1 },
      { id: 1, order: 2 },
      { id: 2, order: 3 }
    ]
  })
});
```

---

## 10. JUDGING & SCORING (Event-scoped)

Base: `/api/events/:eventId/judging`

### Judges

```ts
// GET - Judge siyahısı
const judges = await api('/api/events/1/judging/judges');

// POST - Judge əlavə et (admin)
await api('/api/events/1/judging/judges', {
  method: 'POST',
  body: JSON.stringify({ userId: 5 })
});

// DELETE - Judge sil (admin)
await api('/api/events/1/judging/judges/1', { method: 'DELETE' });
```

### Scoring Criteria

Bulk replace (wizard / admin — preferred; wipes then inserts for the event):

```ts
await api('/api/events/1/judging/criteria', {
  method: 'PUT',
  body: JSON.stringify({
    criteria: [
      { name: 'Innovation', maxScore: 10, weight: 1 },
      { name: 'Execution', maxScore: 10, weight: 1 },
    ],
  }),
});
```

```ts
// GET - Meyarlar siyahısı
const criteria = await api('/api/events/1/judging/criteria');

// POST - Yeni meyar (admin)
await api('/api/events/1/judging/criteria', {
  method: 'POST',
  body: JSON.stringify({
    name: "Innovation",
    description: "How innovative is the project?",
    maxScore: 10,
    weight: 1.5
  })
});

// PUT - Meyar yeniləmək (admin)
await api('/api/events/1/judging/criteria/1', {
  method: 'PUT',
  body: JSON.stringify({
    name: "Innovation",
    description: "Updated description",
    maxScore: 10,
    weight: 2.0
  })
});

// DELETE (admin)
await api('/api/events/1/judging/criteria/1', { method: 'DELETE' });
```

### Scores

```ts
// POST - Xal vermək (judge, admin)
await api('/api/events/1/judging/scores', {
  method: 'POST',
  body: JSON.stringify({
    judgeId: 1,
    submissionId: 1,
    criterionId: 1,
    score: 8.5,
    feedback: "Very innovative approach"
  })
});

// GET - Bütün xallar
const scores = await api('/api/events/1/judging/scores');

// PUT - Xal yeniləmək
await api('/api/events/1/judging/scores/1', {
  method: 'PUT',
  body: JSON.stringify({ score: 9.0, feedback: "Updated" })
});
```

### Leaderboard

```ts
const leaderboard = await api('/api/events/1/judging/leaderboard');

// Response
[
  { "id": 1, "project_name": "App X", "team_name": "Alpha", "total_score": 87.5, "judges_count": 3 },
  { "id": 2, "project_name": "App Y", "team_name": "Beta", "total_score": 82.0, "judges_count": 3 }
]
```

---

## 11. TRACKS (Event-scoped)

Base: `/api/events/:eventId/tracks`

```ts
// GET (auth required)
const tracks = await api('/api/events/1/tracks');

// POST (admin)
await api('/api/events/1/tracks', {
  method: 'POST',
  body: JSON.stringify({
    name: "AI/ML",
    description: "Artificial Intelligence projects",
    color: "#4F46E5"
  })
});

// PUT (admin)
await api('/api/events/1/tracks/1', { method: 'PUT', body: JSON.stringify({...}) });

// DELETE (admin)
await api('/api/events/1/tracks/1', { method: 'DELETE' });
```

---

## 12. PRIZES (Event-scoped)

Base: `/api/events/:eventId/prizes`

```ts
// GET (auth)
const prizes = await api('/api/events/1/prizes');

// POST (admin)
await api('/api/events/1/prizes', {
  method: 'POST',
  body: JSON.stringify({
    name: "Best Overall",
    description: "Top project across all tracks",
    value: "$5000",
    position: 1,
    trackId: null  // null = global prize, or track ID
  })
});

// PUT / DELETE (admin)
```

---

## 13. SPONSORS (Event-scoped)

Base: `/api/events/:eventId/sponsors`

```ts
// GET (public - auth lazım deyil)
const sponsors = await api('/api/events/1/sponsors');

// POST (admin)
await api('/api/events/1/sponsors', {
  method: 'POST',
  body: JSON.stringify({
    name: "TechCorp",
    logo: "https://logo-url.com/logo.png",
    tier: "gold",    // "gold" | "silver" | "bronze" etc.
    website: "https://techcorp.com"
  })
});

// PUT / DELETE (admin)
```

---

## 14. MENTORS (Event-scoped)

Base: `/api/events/:eventId/mentors`

```ts
// GET (auth)
const mentors = await api('/api/events/1/mentors');

// POST (admin)
await api('/api/events/1/mentors', {
  method: 'POST',
  body: JSON.stringify({
    userId: 5,
    expertise: "React, Node.js, DevOps",
    availability: "Saturday 10AM - 6PM"
  })
});

// PUT (admin)
await api('/api/events/1/mentors/1', {
  method: 'PUT',
  body: JSON.stringify({
    expertise: "Updated expertise",
    availability: "Full day"
  })
});

// DELETE (admin)
```

---

## 15. FEEDBACK (Event-scoped)

Base: `/api/events/:eventId/feedback`

```ts
// GET (admin)
const feedback = await api('/api/events/1/feedback');

// POST (any auth user)
await api('/api/events/1/feedback', {
  method: 'POST',
  body: JSON.stringify({
    rating: 5,           // 1-5
    comment: "Great event!",
    type: "general"      // "general" | "suggestion" | "complaint"
  })
});

// DELETE (admin)
```

---

## 16. EVENT SETTINGS (Event-scoped)

Base: `/api/events/:eventId/settings`

```ts
// GET (admin)
const settings = await api('/api/events/1/settings');

// PUT - upsert (admin)
await api('/api/events/1/settings', {
  method: 'PUT',
  body: JSON.stringify({
    key: "registration_open",
    value: "true"
  })
});

// DELETE (admin)
await api('/api/events/1/settings/1', { method: 'DELETE' });
```

---

## 17. CERTIFICATES (Event-scoped)

Base: `/api/events/:eventId/certificates`

```ts
// GET (admin)
const certs = await api('/api/events/1/certificates');

// GET single
const cert = await api('/api/events/1/certificates/1');

// POST - issue (admin)
await api('/api/events/1/certificates', {
  method: 'POST',
  body: JSON.stringify({
    userId: 5,
    type: "participation",    // "participation" | "winner" | "mentor" etc.
    templateId: "template-v1"
  })
});

// DELETE (admin)
```

---

## FRONTEND DƏYİŞİKLİK CHECKLIST

### Silinməli olan şeylər:
- [ ] `localStorage.getItem/setItem` ilə data saxlama (bütün page-lərdə)
- [ ] `document.cookie = ...` ilə cookie set etmə (LoginClient.tsx)
- [ ] Hardcoded demo passwords (LoginClient.tsx line ~34-37)
- [ ] Fake OTP (localStorage-da saxlanan OTP)
- [ ] Mock/fake data array-ləri

### Əvəzlənməli:
- [ ] `LoginClient.tsx` → `POST /api/auth/login` + `POST /api/auth/register`
- [ ] `middleware.ts` → `GET /api/auth/me` ilə auth yoxlama
- [ ] `join/[eventCode]/page.tsx` → `GET /api/events/:code` + `POST /api/teams` + `POST /api/teams/join`
- [ ] `(dashboard)/*` page-lər → `GET /api/events`, `GET /api/users`, etc.
- [ ] `hacker/*` page-lər → `GET /api/teams/mine`, `POST /api/submissions`, `POST /api/tickets`
- [ ] `judge/*` page-lər → `GET /api/submissions`, `POST /api/events/:id/judging/scores`
- [ ] `mentor/*` page-lər → `GET /api/tickets`, `PATCH /api/tickets/:id/claim`
- [ ] `create-event/*` wizard → `POST /api/events`
- [ ] CSV import/export → server-side endpoint lazımdır (hələ yoxdur)

### Əlavə olunmalı:
- [ ] `NEXT_PUBLIC_API_URL` env dəyişəni
- [ ] Global `api()` helper funksiyası (yuxarıda göstərildiyi kimi)
- [ ] Error handling UI (loading, error states)
- [ ] `credentials: 'include'` bütün fetch sorğularında

### CORS Qeydləri:
- Backend `CLIENT_URL` env dəyişəni ilə CORS idarə edir
- Frontend deploy olandan sonra Render-də `CLIENT_URL=https://your-frontend.vercel.app` env əlavə edin
- Local development üçün default `http://localhost:3000` istifadə olunur

### Cookie Qeydləri:
- Production-da cookie `secure: true, sameSite: 'none'` olur
- Frontend və backend fərqli domain-lərdədirsə (məs: Vercel + Render), `sameSite: 'none'` + `secure: true` tələb olunur
- Bu artıq backend-də konfiqurasiya olunub, frontend sadəcə `credentials: 'include'` istifadə etsin

### DB Field Adları:
- Backend PostgreSQL snake_case istifadə edir: `full_name`, `event_code`, `team_size_limit`, `github_link`, `join_code`
- Cavablarda da snake_case gəlir. Frontend-də ya mapping edin, ya snake_case ilə işləyin.
- İstisna: auth endpoint-lərdə body camelCase (`fullName`, `githubLink`) gözləyir
