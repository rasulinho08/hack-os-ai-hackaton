# Holberton Hackathon Management System — Tam Funksionallıq Sənədləşdirməsi

> **Backend:** Node.js + Express + PostgreSQL  
> **Frontend:** Next.js 14 (App Router) + TailwindCSS  
> **Rollər:** `admin` · `hacker` · `mentor` · `judge`

---

## İÇİNDƏKİLƏR

1. [Autentifikasiya (Auth)](#1-autentifikasiya)
2. [İstifadəçilər (Users)](#2-istifadəçilər)
3. [Tədbirlər (Events)](#3-tədbirlər)
4. [İştirakçılar (Participants)](#4-iştirakçılar)
5. [Komandalar (Teams)](#5-komandalar)
6. [Komanda Dəvətləri (Team Invites)](#6-komanda-dəvətləri)
7. [Layihə Təqdimləri (Submissions)](#7-layihə-təqdimləri)
8. [Prezentasiyalar (Presentations)](#8-prezentasiyalar)
9. [Hakim Sistemi (Judging)](#9-hakim-sistemi)
10. [Mentorlar (Mentors)](#10-mentorlar)
11. [Elanlar (Announcements)](#11-elanlar)
12. [Help Tickets](#12-help-tickets)
13. [Tracks](#13-tracks)
14. [Mükafatlar (Prizes)](#14-mükafatlar)
15. [Sponsorlar (Sponsors)](#15-sponsorlar)
16. [Feedback](#16-feedback)
17. [Tənzimləmələr (Settings)](#17-tənzimləmələr)
18. [Sertifikatlar (Certificates)](#18-sertifikatlar)
19. [Event Dəvətləri (Invites)](#19-event-dəvətləri)
20. [DB Schema](#20-db-schema)
21. [Frontend Səhifələri](#21-frontend-səhifələri)
22. [CSV Import Axını](#22-csv-import-axını)

---

## 1. Autentifikasiya

**Base:** `/api/auth`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| POST | `/register` | ✗ | — | Yeni istifadəçi qeydiyyatı. Rate-limited. |
| POST | `/login` | ✗ | — | Email + şifrə ilə giriş. JWT token qaytarır. |
| POST | `/logout` | ✗ | — | Çıxış (cookie təmizlənir). |
| GET | `/me` | ✓ | * | Cari istifadəçinin profili (bütün sahələr). |

### Register — `POST /api/auth/register`
```json
{
  "fullName": "Ad Soyad",
  "email": "user@mail.com",
  "password": "MinimumSekiz1!",
  "githubLink": "https://github.com/user",
  "phone": "+994501234567",
  "age": 22,
  "country": "Azerbaijan",
  "timezone": "Asia/Baku",
  "linkedin": "https://linkedin.com/in/user",
  "attendanceMode": "online",
  "university": "Holberton School",
  "cohort": "C22",
  "skills": ["JavaScript", "Python", "React"],
  "experience": "intermediate",
  "rolePreference": "Frontend Developer",
  "dietary": "Yoxdur",
  "tshirtSize": "M",
  "motivation": "Hackathon-da iştirak etmək istəyirəm",
  "howHeard": "Social media"
}
```

### Login — `POST /api/auth/login`
```json
{
  "email": "user@mail.com",
  "password": "MinimumSekiz1!"
}
```
**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": 1,
      "full_name": "Ad Soyad",
      "email": "user@mail.com",
      "role": "hacker",
      "github_link": "...",
      "phone": "...",
      "age": 22,
      "country": "Azerbaijan",
      "skills": ["JavaScript", "Python"],
      "experience": "intermediate",
      "university": "...",
      "..."
    },
    "token": "eyJhbG..."
  }
}
```

---

## 2. İstifadəçilər

**Base:** `/api/users`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| POST | `/bulk-import` | ✓ | admin | CSV-dən toplu istifadəçi import (user + participant yaradır) |
| POST | `/` | ✓ | admin | Tək istifadəçi yarat (admin paneldən) |
| GET | `/` | ✓ | admin, mentor, judge, hacker | Bütün istifadəçiləri siyahıla. `?role=hacker` ilə filtr. |
| GET | `/:id` | ✓ | self/admin | İstifadəçi profili (IDOR qorumalı) |
| PATCH | `/:id` | ✓ | self/admin | Profil yenilə (ad, avatar, telefon, skills, və s.) |
| DELETE | `/:id` | ✓ | admin | İstifadəçi sil |
| PATCH | `/:id/role` | ✓ | admin | Rol dəyiş |

### Bulk Import — `POST /api/users/bulk-import`
```json
{
  "users": [
    {
      "full_name": "Hacker One",
      "email": "hacker1@mail.com",
      "password": "Holberton2024!",
      "phone": "+994501111111",
      "age": 20,
      "country": "Azerbaijan",
      "github_link": "https://github.com/hacker1",
      "skills": ["Python", "Flask"],
      "experience": "beginner",
      "university": "BDU",
      "is_solo": true
    }
  ],
  "eventId": 1,
  "defaultPassword": "Holberton2024!"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Import complete: 15 created, 3 skipped",
  "data": { "created": 15, "skipped": 3, "errors": [] }
}
```

### Create User (Admin) — `POST /api/users`
```json
{
  "fullName": "Judge Test",
  "email": "judge@test.com",
  "password": "Test1234!",
  "role": "judge",
  "githubLink": "https://github.com/judge"
}
```

### Update User — `PATCH /api/users/:id`
```json
{
  "full_name": "Yeni Ad",
  "phone": "+994551234567",
  "age": 25,
  "country": "Turkey",
  "skills": ["React", "Node.js"],
  "experience": "advanced",
  "github_link": "https://github.com/newuser"
}
```

---

## 3. Tədbirlər

**Base:** `/api/events`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| GET | `/` | ✓ | * | Bütün tədbirləri siyahıla |
| GET | `/active` | ✓ | * | Aktiv tədbiri al |
| GET | `/details/:id` | ✓ | admin | Tədbir tam məlumatı (wizard edit üçün) |
| GET | `/:id/analytics` | ✓ | admin | Tədbir analitikası |
| GET | `/:identifier` | ✗ | — | ID və ya event_code ilə tədbir al |
| POST | `/:code/join` | ✗ | — | Event-ə qoşulma (qeydiyyat axını) |
| POST | `/` | ✓ | admin | Yeni tədbir yarat |
| PUT | `/:id` | ✓ | admin | Tədbir yenilə |
| DELETE | `/:id` | ✓ | admin | Tədbir sil |
| POST | `/:id/publish` | ✓ | admin | Tədbiri yayınla |
| POST | `/:id/archive` | ✓ | admin | Tədbiri arxivlə |

### Create Event — `POST /api/events`
```json
{
  "event_code": "HBTN2025",
  "name": "Holberton Hackathon 2025",
  "description": "Annual hackathon event",
  "start_date": "2025-06-01T09:00:00Z",
  "end_date": "2025-06-03T18:00:00Z",
  "status": "upcoming",
  "team_size_limit": 4,
  "is_published": true
}
```

---

## 4. İştirakçılar

**Base:** `/api/events/:eventId/participants`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| GET | `/` | ✓ | admin | Bütün iştirakçılar (user data ilə birlikdə) |
| GET | `/:id` | ✓ | admin, mentor, judge | Tək iştirakçı |
| POST | `/` | ✓ | admin | İştirakçı əlavə et (email ilə user tap/yarat) |
| POST | `/self` | ✓ | hacker | Özünü iştirakçı kimi qeydiyyatdan keçir |
| PATCH | `/:id` | ✓ | admin | Status yenilə (pending → approved / rejected) |
| DELETE | `/:id` | ✓ | admin | İştirakçı sil |
| POST | `/:id/eliminate` | ✓ | admin | İştirakçını eliminasiya et |

### Add Participant — `POST /api/events/:eventId/participants`
```json
{
  "email": "hacker@test.com",
  "full_name": "Hacker Test",
  "status": "approved"
}
```

### Self Register — `POST /api/events/:eventId/participants/self`
```json
{
  "is_solo": true
}
```

---

## 5. Komandalar

**Base:** `/api/teams`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| GET | `/` | ✓ | admin, mentor, judge | Bütün komandalar |
| GET | `/mine` | ✓ | hacker | Mənim komandam |
| POST | `/` | ✓ | hacker | Yeni komanda yarat |
| POST | `/join` | ✓ | hacker | Komandaya join_code ilə qoşul |
| GET | `/:id` | ✓ | * | Komanda detalları |
| PUT | `/:id` | ✓ | * | Komanda yenilə |
| DELETE | `/:id` | ✓ | admin | Komanda sil |
| GET | `/:id/members` | ✓ | * | Komanda üzvləri |
| POST | `/:id/members` | ✓ | * | Üzv əlavə et |
| DELETE | `/:id/members/:userId` | ✓ | * | Üzv çıxar |

### Create Team — `POST /api/teams`
```json
{
  "eventId": 1,
  "name": "Code Warriors"
}
```

### Join Team — `POST /api/teams/join`
```json
{
  "joinCode": "ABC123"
}
```

---

## 6. Komanda Dəvətləri

**Base:** `/api/team-invites`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| POST | `/` | ✓ | hacker | Dəvət göndər |
| GET | `/incoming` | ✓ | hacker | Mənə gələn dəvətlər |
| GET | `/outgoing` | ✓ | hacker | Mənim göndərdiklərim |
| POST | `/:id/accept` | ✓ | hacker | Dəvəti qəbul et |
| POST | `/:id/decline` | ✓ | hacker | Dəvəti rədd et |
| DELETE | `/:id` | ✓ | hacker | Dəvəti ləğv et |

### Send Invite — `POST /api/team-invites`
```json
{
  "teamId": 1,
  "inviteeEmail": "teammate@mail.com"
}
```

---

## 7. Layihə Təqdimləri

**Base:** `/api/submissions`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| POST | `/` | ✓ | hacker | Layihə təqdim et |
| GET | `/` | ✓ | hacker, judge, admin, mentor | Bütün təqdimlər |
| GET | `/:id` | ✓ | hacker, judge, admin, mentor | Tək təqdim |
| PUT | `/:id` | ✓ | hacker, admin | Təqdim yenilə |
| DELETE | `/:id` | ✓ | admin | Təqdim sil |

### Submit Project — `POST /api/submissions`
```json
{
  "teamId": 1,
  "eventId": 1,
  "project_name": "HackTracker",
  "description": "Real-time hackathon management tool",
  "repo_link": "https://github.com/team/hacktracker",
  "demo_link": "https://hacktracker.vercel.app",
  "tech_stack": "Next.js, Node.js, PostgreSQL"
}
```

---

## 8. Prezentasiyalar

**Base:** `/api/events/:eventId/presentations`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| GET | `/` | ✓ | * | Prezentasiya siyahısı |
| POST | `/` | ✓ | admin | Prezentasiya yarat |
| PATCH | `/:id` | ✓ | admin | Prezentasiya yenilə |
| PUT | `/reorder` | ✓ | admin | Sıranı dəyiş |
| DELETE | `/:id` | ✓ | admin | Sil |

### Create Presentation — `POST /api/events/:eventId/presentations`
```json
{
  "submission_id": 1,
  "team_id": 1,
  "scheduled_at": "2025-06-03T10:00:00Z",
  "duration": 10,
  "presentation_order": 1,
  "drive_link": "https://drive.google.com/..."
}
```

---

## 9. Hakim Sistemi (Judging)

**Base:** `/api/events/:eventId/judging`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| **Judges** |
| GET | `/judges` | ✓ | admin, judge, mentor, hacker | Hakim siyahısı |
| POST | `/judges` | ✓ | admin | Hakim təyin et |
| DELETE | `/judges/:id` | ✓ | admin | Hakim çıxar |
| **Criteria** |
| GET | `/criteria` | ✓ | admin, judge | Qiymətləndirmə meyarları |
| POST | `/criteria` | ✓ | admin | Meyar əlavə et |
| PUT | `/criteria` | ✓ | admin | Bütün meyarları əvəzlə |
| PUT | `/criteria/:id` | ✓ | admin | Tək meyar yenilə |
| DELETE | `/criteria/:id` | ✓ | admin | Meyar sil |
| **Scores** |
| GET | `/scores` | ✓ | admin, judge | Bütün ballar |
| POST | `/scores` | ✓ | judge, admin | Bal ver |
| PUT | `/scores/:id` | ✓ | judge, admin | Bal yenilə |
| **Leaderboard** |
| GET | `/leaderboard` | ✓ | * | Liderlik cədvəli |

### Assign Judge — `POST /api/events/:eventId/judging/judges`
```json
{
  "userId": 3
}
```

### Create Criterion — `POST /api/events/:eventId/judging/criteria`
```json
{
  "name": "Innovation",
  "description": "How innovative is the solution?",
  "max_score": 10,
  "weight": 1.5
}
```

### Submit Score — `POST /api/events/:eventId/judging/scores`
```json
{
  "submission_id": 1,
  "criterion_id": 1,
  "score": 8.5,
  "feedback": "Great innovation, well executed"
}
```

---

## 10. Mentorlar

**Base:** `/api/events/:eventId/mentors`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| GET | `/` | ✓ | * | Mentor siyahısı |
| POST | `/` | ✓ | admin | Mentor təyin et |
| PUT | `/:id` | ✓ | admin | Mentor yenilə |
| DELETE | `/:id` | ✓ | admin | Mentor çıxar |

### Assign Mentor — `POST /api/events/:eventId/mentors`
```json
{
  "userId": 2,
  "expertise": "Backend, DevOps",
  "availability": "Day 1-2, 10:00-18:00"
}
```

---

## 11. Elanlar

**Base:** `/api/announcements`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| GET | `/` | ✗ | — | Bütün elanlar (public) |
| POST | `/` | ✓ | admin | Elan yarat |
| PUT | `/:id` | ✓ | admin | Elan yenilə |
| DELETE | `/:id` | ✓ | admin | Elan sil |
| POST | `/telegram` | ✗ | — | Telegram-dan elan (service secret ilə) |

### Create Announcement — `POST /api/announcements`
```json
{
  "event_id": 1,
  "title": "Hackathon başladı!",
  "content": "Bütün komandalara uğurlar!",
  "type": "info",
  "priority": "high"
}
```

---

## 12. Help Tickets

**Base:** `/api/tickets`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| POST | `/` | ✓ | hacker | Yeni ticket yarat |
| GET | `/` | ✓ | hacker, mentor, admin | Ticket siyahısı |
| PATCH | `/:id/claim` | ✓ | mentor, admin | Ticket-i öz üzərinə götür |
| PATCH | `/:id/assign` | ✓ | admin | Ticket-i mentora təyin et |
| PATCH | `/:id/resolve` | ✓ | mentor, admin | Ticket-i həll et |
| PATCH | `/:id` | ✓ | admin | Ticket yenilə |
| DELETE | `/:id` | ✓ | admin | Ticket sil |

### Create Ticket — `POST /api/tickets`
```json
{
  "event_id": 1,
  "topic": "Docker problemi",
  "description": "Container build olmur, log əlavə edirəm",
  "table_location": "Masa 5",
  "contact_phone": "+994501234567",
  "priority": "high"
}
```

---

## 13. Tracks

**Base:** `/api/events/:eventId/tracks`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| GET | `/` | ✓ | * | Track siyahısı |
| POST | `/` | ✓ | admin | Track yarat |
| PUT | `/:id` | ✓ | admin | Track yenilə |
| DELETE | `/:id` | ✓ | admin | Track sil |

```json
{
  "name": "AI & Machine Learning",
  "description": "AI/ML focused projects",
  "color": "#8B5CF6"
}
```

---

## 14. Mükafatlar

**Base:** `/api/events/:eventId/prizes`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| GET | `/` | ✓ | * | Mükafat siyahısı |
| POST | `/` | ✓ | admin | Mükafat yarat |
| PUT | `/:id` | ✓ | admin | Mükafat yenilə |
| DELETE | `/:id` | ✓ | admin | Mükafat sil |

```json
{
  "name": "1st Place",
  "description": "Grand prize",
  "value": "$5000",
  "track_id": 1,
  "position": 1
}
```

---

## 15. Sponsorlar

**Base:** `/api/events/:eventId/sponsors`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| GET | `/` | ✗ | — | Sponsor siyahısı (public) |
| POST | `/` | ✓ | admin | Sponsor əlavə et |
| PUT | `/:id` | ✓ | admin | Sponsor yenilə |
| DELETE | `/:id` | ✓ | admin | Sponsor sil |

```json
{
  "name": "TechCorp",
  "logo": "https://example.com/logo.png",
  "tier": "gold",
  "website": "https://techcorp.com"
}
```

---

## 16. Feedback

**Base:** `/api/events/:eventId/feedback`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| GET | `/` | ✓ | admin | Feedback siyahısı |
| POST | `/` | ✓ | * | Feedback göndər |
| DELETE | `/:id` | ✓ | admin | Feedback sil |

```json
{
  "rating": 5,
  "comment": "Əla təşkil olunmuş hackathon!",
  "type": "general"
}
```

---

## 17. Tənzimləmələr

**Base:** `/api/events/:eventId/settings`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| GET | `/` | ✓ | admin | Tənzimləmələr |
| PUT | `/` | ✓ | admin | Tənzimləmə yarat/yenilə |
| DELETE | `/:id` | ✓ | admin | Tənzimləmə sil |

```json
{
  "key": "submission_deadline",
  "value": "2025-06-03T16:00:00Z"
}
```

---

## 18. Sertifikatlar

**Base:** `/api/events/:eventId/certificates`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| GET | `/` | ✓ | admin | Sertifikat siyahısı |
| GET | `/:id` | ✓ | * | Sertifikat əldə et |
| POST | `/` | ✓ | admin | Sertifikat ver |
| DELETE | `/:id` | ✓ | admin | Sertifikat sil |

```json
{
  "user_id": 5,
  "type": "participation",
  "template_id": "TMPL_HACK_2025"
}
```

---

## 19. Event Dəvətləri

**Base:** `/api/events/:eventId/invites`

| Method | Endpoint | Auth | Rol | Açıqlama |
|--------|----------|------|-----|----------|
| GET | `/` | ✓ | admin | Dəvət siyahısı |
| POST | `/` | ✓ | admin | Yeni dəvət göndər |
| DELETE | `/:id` | ✓ | admin | Dəvət sil |

```json
{
  "email": "newjudge@mail.com",
  "role": "judge"
}
```

---

## 20. DB Schema

### Cədvəllər və Əlaqələr

```
users ─┬─→ participants ←── events
       ├─→ team_members ←── teams ←── events
       ├─→ submissions ←── teams + events
       ├─→ judges ←── events
       ├─→ mentor_assignments ←── events
       ├─→ help_tickets ←── events
       ├─→ feedback ←── events
       ├─→ certificates ←── events
       └─→ event_invites ←── events

events ─┬─→ tracks → prizes
        ├─→ sponsors
        ├─→ announcements
        ├─→ presentations ←── submissions
        ├─→ scoring_criteria → scores ←── judges + submissions
        └─→ event_settings
```

### `users` cədvəli sahələri
| Sahə | Tip | Açıqlama |
|------|-----|----------|
| id | SERIAL PK | |
| full_name | VARCHAR(200) | Ad Soyad |
| email | VARCHAR(255) UNIQUE | Email |
| password_hash | TEXT | Bcrypt hash |
| role | VARCHAR(50) | admin / hacker / mentor / judge |
| avatar | TEXT | Avatar URL |
| github_link | TEXT | GitHub profili |
| phone | VARCHAR(30) | Telefon |
| age | SMALLINT | Yaş |
| country | VARCHAR(100) | Ölkə |
| timezone | VARCHAR(100) | Vaxt zonası |
| linkedin | TEXT | LinkedIn profili |
| attendance_mode | VARCHAR(20) | online / offline |
| university | VARCHAR(200) | Universitet |
| cohort | VARCHAR(100) | Kohort |
| skills | JSONB | Bacarıqlar `["JS","Python"]` |
| experience | VARCHAR(50) | beginner / intermediate / advanced |
| role_preference | VARCHAR(100) | İstədiyi rol |
| dietary | VARCHAR(100) | Qida tələbi |
| tshirt_size | VARCHAR(10) | T-shirt ölçüsü |
| motivation | TEXT | Motivasiya |
| how_heard | VARCHAR(100) | Haradan eşidib |

---

## 21. Frontend Səhifələri

### Admin Dashboard (`/dashboard/...`)
| Səhifə | Path | Funksiya |
|--------|------|----------|
| Ana Səhifə | `/` | Ümumi statistika, event seçim |
| İştirakçılar | `/participants` | Siyahı, CSV import, status dəyiş, eliminasiya |
| Komandalar | `/teams` | Komanda siyahısı, üzv idarəsi |
| Təqdimlər | `/submissions` | Layihə təqdimləri |
| Hakimlər | `/judges` | Hakim təyin, meyar yarat, ballar |
| Mentorlar | `/mentors` | Mentor təyin/idarə |
| Prezentasiyalar | `/presentations` | Prezentasiya sırası |
| Elanlar | `/announcements` | Elan yarat/yenilə (Telegram ilə) |
| Analitika | `/analytics` | Tədbir statistikası |
| Eliminasiya | `/eliminate` | İştirakçı eliminasiyası |
| Nəticələr | `/results` | Liderlik cədvəli |
| Help Queue | `/help-queue` | Kömək biletləri |
| Feedback | `/feedback` | Geri bildirim |
| Tənzimləmələr | `/settings` | Event tənzimləmələri |
| Arxiv | `/archive` | Arxivlənmiş tədbirlər |

### Hacker Portal (`/hacker/...`)
| Səhifə | Path | Funksiya |
|--------|------|----------|
| Dashboard | `/` | Ümumi baxış, countdown |
| Profil | `/profile` | Profil bax/redaktə (bütün sahələr) |
| Komanda | `/team` | Komanda idarəsi, dəvət |
| Submit | `/submit` | Layihə təqdimatı |
| Lobby | `/lobby` | İştirakçı lobbisi |
| Help | `/help` | Kömək istə |
| Elanlar | `/announcements` | Elanları oxu |
| Resurslar | `/resources` | Faydalı linklər |

### Mentor Portal (`/mentor/...`)
| Səhifə | Path | Funksiya |
|--------|------|----------|
| Dashboard | `/` | Ümumi baxış |
| Help Queue | `/help-queue` | Biletlər siyahısı |
| My Tickets | `/my-tickets` | Öz biletlərim |
| Teams | `/teams` | Komanda baxışı |
| Elanlar | `/announcements` | Elanlar |
| Resurslar | `/resources` | Resurslar |

### Judge Portal (`/judge`)
| Səhifə | Path | Funksiya |
|--------|------|----------|
| Dashboard | `/` | Qiymətləndirmə paneli |

### Digər
| Səhifə | Path | Funksiya |
|--------|------|----------|
| Login | `/login` | Giriş |
| Join Event | `/join/:eventCode` | Qeydiyyat (multi-step form) |
| Create Event | `/create-event` | Yeni tədbir (admin) |
| FAQ | `/faq` | Tez-tez verilən suallar |

---

## 22. CSV Import Axını

### Google Forms → CSV → Sistem

1. **Google Forms** vasitəsilə iştirakçı məlumatları toplanır
2. CSV export edilir
3. Admin paneldə **İştirakçılar** → **Import CSV** basılır
4. Sistem `POST /api/users/bulk-import` çağırır
5. Hər sətir üçün:
   - Email ilə mövcud user axtarılır
   - Yoxdursa → User yaradılır (default şifrə: `Holberton2024!`)
   - Participant record yaradılır (status: `approved`)
6. İstifadəçi **email + şifrə** ilə login ola bilər

### Dəstəklənən CSV sütunları:
```
Full Name, Email, Password, Phone, Age, Country, Timezone,
GitHub, LinkedIn, Attendance, University, Cohort, Skills,
Experience, Role, Dietary, T-Shirt, Solo
```

**Skills** sütunu vergül və ya nöqtəli vergüllə ayrılır: `JavaScript, Python, React`

---

## Auth Headers

Bütün autentifikasiya tələb edən sorğularda:
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

## Rollər və İcazələr

| Əməliyyat | admin | mentor | judge | hacker |
|-----------|:-----:|:------:|:-----:|:------:|
| Event CRUD | ✓ | ✗ | ✗ | ✗ |
| User CRUD | ✓ | ✗ | ✗ | ✗ |
| Bulk Import | ✓ | ✗ | ✗ | ✗ |
| İştirakçı idarəsi | ✓ | ✗ | ✗ | ✗ |
| Komanda yarat/qoşul | ✗ | ✗ | ✗ | ✓ |
| Layihə təqdim et | ✗ | ✗ | ✗ | ✓ |
| Qiymətləndirmə | ✓ | ✗ | ✓ | ✗ |
| Help ticket yarat | ✗ | ✗ | ✗ | ✓ |
| Help ticket həll et | ✓ | ✓ | ✗ | ✗ |
| Elan yarat | ✓ | ✗ | ✗ | ✗ |
| Elan oxu | ✓ | ✓ | ✓ | ✓ |
| Profil redaktə | öz | ✗ | ✗ | öz |
| Leaderboard bax | ✓ | ✓ | ✓ | ✓ |
