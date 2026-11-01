# Backend API — frontend müqaviləsi

`src/lib/api.ts`: `fetch`, `credentials: "include"`, cavab: `{ success, data }` / xəta: `{ success: false, message }`. `204` — bədən boş ola bilər.

---

## Rol → redirect (login cavabındakı `data.role`)

| role | path |
|------|------|
| admin, org_admin | `/` |
| judge | `/judge` |
| mentor | `/mentor` |
| hacker, pending | `/hacker` |

---

## Auth

**POST /api/auth/register**

- `/login` register: `{ fullName, email, password }` — `?eventId` / `?eventCode` varsa body-ə əlavə olunur. Əgər URL-də yoxdursa və `GET /api/events` **tək sətir** qaytarırsa, frontend avtomatik həmin event-in `id` (və lazımdırsa `eventCode`) göndərir. Yoxlama: Network → register → Payload-da `eventId`.
- `/join/...` register: `{ fullName, email, password, role, githubLink, eventId }` — frontend tez-tez `role: "hacker"` göndərir.

**Qayda:** `eventId`+`email` üzrə `event_invites` cədvəlində uyğun sətir varsa → istifadəçi rolunu **invite.role** ilə yaradın; client `role`-unu ləğv edin; invite-i bağlayın (`used_at` / `user_id`). Invite yoxdursa client/default.

**POST /api/auth/login** — body: `{ email, password }`. `data` minimum: `id`, `full_name`, `email`, `role`, `github_link?`.

**POST /api/auth/logout** — `{}`

**GET /api/auth/me** — cari user (yuxarıdakı sahələr).

Register-dən sonra frontend dərhal **login** çağırır; əsas rol **login** cavabındadır.

---

## Invites

| Method | Path |
|--------|------|
| GET | `/api/events/{eventId}/invites` |
| POST | `/api/events/{eventId}/invites` — body `{ email, role }`, role: `hacker` \| `mentor` \| `judge` |
| DELETE | `/api/events/{eventId}/invites/{inviteId}` |

`event_invites` (minimal): `event_id`, `email`, `role`, `used_at?`, `user_id?`

---

## Events

| Method | Path | Qeyd |
|--------|------|------|
| GET | `/api/events` | Siyahı: `id`, `name`, `event_code`, tarixlər, `status` |
| GET | `/api/events/{eventCode}` | Join; `event_code`, `team_size_limit`, … |
| GET | `/api/events/active` | Hacker |
| POST | `/api/events` | Wizard: `eventCode`, `name`, …; istəyə görə `criteria: [{ name, maxScore, weight }]` (və ya `judging.criteria`) — event yaradılanda `scoring_criteria` yazılır |
| POST | `/api/events/{id}/publish` | `{}` |
| DELETE | `/api/events/{id}` | Admin/creator: tam tədbiri silir (cascade və ya backend qaydası ilə) |

---

## İştirakçılar

| GET | `/api/events/{eventId}/participants` |
| POST | `/api/events/{eventId}/participants` |
| PATCH | `/api/events/{eventId}/participants/{id}` |
| DELETE | `/api/events/{eventId}/participants/{id}` |

---

## Komandalar

| GET | `/api/teams?eventId={id}` |
| GET | `/api/teams/mine` |
| POST | `/api/teams` — `{ eventId, name }` |
| PUT | `/api/teams/{teamId}` |
| DELETE | `/api/teams/{teamId}/members/{memberId}` |
| POST | `/api/teams/{teamId}/members` |
| PATCH | `/api/teams/{teamId}/members/{memberId}/lead` — Transfer team leadership (only the current leader may call). Demotes the old leader and promotes `memberId`; updates `teams.leader_id` and `team_members.is_leader`. |

---

## Submissions

| GET | `/api/submissions?eventId={id}` |
| GET | `/api/submissions` |
| POST | `/api/submissions` |
| PUT | `/api/submissions/{id}` |
| DELETE | `/api/submissions/{id}` |

---

## Tickets

| GET | `/api/tickets?eventId={id}` |
| POST | `/api/tickets` |
| PATCH | `/api/tickets/{id}/claim` |
| PATCH | `/api/tickets/{id}/resolve` |
| DELETE | `/api/tickets/{id}` |

---

## Elanlar

| GET | `/api/announcements?eventId={id}` |
| POST | `/api/announcements` |
| DELETE | `/api/announcements/{id}` |

---

## Mentorlar (admin)

| GET | `/api/events/{eventId}/mentors` |
| POST | `/api/events/{eventId}/mentors` |
| PUT | `/api/events/{eventId}/mentors/{id}` |
| DELETE | `/api/events/{eventId}/mentors/{id}` |

---

## Hakimlər (admin)

| GET | `/api/events/{eventId}/judging/judges` |
| POST | `/api/events/{eventId}/judging/judges` |
| DELETE | `/api/events/{eventId}/judging/judges/{id}` |

---

## Hakimləmə

| GET | `/api/events/{eventId}/judging/criteria` |
| PUT və ya POST | `/api/events/{eventId}/judging/criteria` — body `{ criteria: [{ name, maxScore }] }` (wizard publish sonrası sinxron üçün) |
| GET | `/api/events/{eventId}/judging/scores` |
| PUT | `/api/events/{eventId}/judging/scores/{scoreId}` |
| POST | `/api/events/{eventId}/judging/scores` |

---

## Prezentasiyalar

| GET | `/api/events/{eventId}/presentations` |
| PATCH | `/api/events/{eventId}/presentations/{id}` |
| PUT | `/api/events/{eventId}/presentations/reorder` — `{ order: [id,…] }` |

---

## Feedback

| GET | `/api/events/{eventId}/feedback` |
| POST | `/api/events/{eventId}/feedback` |

---

## Settings

| GET | `/api/events/{eventId}/settings` |
| PUT | `/api/events/{eventId}/settings` |

---

## Users

| GET | `/api/users?role=hacker` |
| PATCH | `/api/users/{id}` |

---

## Qeyd

Bəzi mentor/hacker/judge səhifələrində frontend hələ `eventId=1` sabit istifadə edə bilər. `hh_role` cookie yalnız UI üçündür; icazə serverdə.

---

## Checklist

- [ ] Cavab formatı: `success` + `data` / `message`
- [ ] Register: invite üstünlüyü (`email` + `eventId`)
- [ ] Login: düzgün `role`
- [ ] `GET /api/events`, `GET /api/events/{code}`, invites CRUD
- [ ] Event-scoped sorğular `eventId` ilə

---

## Backend yoxlama (deploy əvvəl)

**1. `POST /api/auth/register`**

- Body: `{ fullName, email, password, eventId }` gələndə `event_invites` cədvəlində **eyni `event_id` + email** (case-insensitive) sətir varmı?
- Varsa: yeni `users` sətirində `role` = invite-dakı `role` (`mentor` / `judge` / `hacker`), invite `used_at` və ya `user_id` yenilənir.
- `eventId` yoxdursa: köhnə məntiq (default `hacker` və ya yalnız email üzrə invite — sizin qaydanız).

**2. `POST /api/auth/login`**

- Cavab `data.role` DB-dəki `users.role` ilə eynidir (xüsusən invite-dan sonra).

**3. Cədvəl uyğunluğu**

- `event_invites`: `event_id`, `email`, `role`, `used_at` / `user_id` — frontend `GET /api/events/{id}/invites` gözləyir.

**4. Əl testi (brauzer)**

- Admin: Preview-də mentor üçün invite + **“Mentor / judge signup link”** (`/login?eventId=...`) kopyala.
- İnkognito: həmin linkdən Register — eyni email.
- Supabase `users`: yeni sətirdə `role` = `mentor` (və ya `judge`).
- Əgər yenə `hacker`dırsa: register handler-də invite lookup **hələ yoxdur** və ya `eventId` parse olunmur.

**5. Köhnə səhv qeydlər**

- Əvvəl `hacker` kimi yaradılmış istifadəçilər avtomatik düzəlmir — `role`-u DB-də əl ilə düzəlt və ya yenidən user sil / yenidən qeydiyyat.
