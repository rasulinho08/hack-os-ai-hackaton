# Deploy (pulsuz planlarla)

Üç hissə: **Supabase** (verilənlər bazası) → **Render** (backend API) → **Vercel** (frontend).
Təxmini vaxt: 30–45 dəqiqə. Hər üçünə GitHub hesabı ilə daxil olmaq olar.

> Açarları və parolları heç vaxt koda, commit-ə və ya çata yazmayın — yalnız
> hostinqin "Environment Variables" bölməsinə.

---

## 1. Supabase — verilənlər bazası

1. https://supabase.com → **New project**.
   - Name: `hackos`
   - Database password: güclü parol yaradın və bir yerdə saxlayın
   - Region: **Central EU (Frankfurt)** (Render ilə eyni yer — sürətli olur)
2. Layihə hazır olanda yuxarıdakı **Connect** düyməsi → **Session pooler** bölməsi.
   URI-ni kopyalayın, `[YOUR-PASSWORD]` yerinə parolu yazın:
   ```
   postgresql://postgres.xxxx:PAROL@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   ```
   Bu, `DATABASE_URL`-dir. **Direct connection** yox, **Session pooler** (port 5432) götürün —
   Render-in pulsuz planı birbaşa bağlantıya qoşula bilmir.

Cədvəlləri yaratmağa ehtiyac yoxdur: backend ilk açılışda miqrasiyaları özü işə salır.

---

## 2. Render — backend API

1. https://render.com → **New** → **Blueprint** → `hack-os-ai-hackaton` reposunu seçin.
   Render kökdəki `render.yaml`-ı oxuyur (`rootDir: backend`) və `hackos-api` servisini təklif edir.
2. Render dəyərləri soruşacaq. Bunları doldurun, qalanını **boş buraxın**:

   | Dəyişən | Dəyər |
   | --- | --- |
   | `DATABASE_URL` | Supabase-dən kopyaladığınız URI |
   | `FRONTEND_URL` | hələlik `https://example.com` (3-cü addımdan sonra dəyişəcəyik) |
   | `FRONTEND_URLS` | eyni dəyər |
   | `SUPERADMIN_EMAILS` | öz e-poçtunuz |

   `JWT_SECRET` Render özü yaradır.
3. Servis yarananda **Environment** bölməsinə bunları əlavə edin:

   | Dəyişən | Dəyər |
   | --- | --- |
   | `DATA_ENCRYPTION_KEY` | təsadüfi 32 bayt (aşağıya baxın) |
   | `MODEL_API_KEY` | dev.meta.ai → **API keys**-dən açar |
   | `META_AI_MODEL` | `muse-spark-1.2` (dev.meta.ai → **Models**-da adı yoxlayın) |

   `DATA_ENCRYPTION_KEY` üçün kompüterinizdə (Node quraşdırılıbsa):
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Node yoxdursa: https://generate-random.org/encryption-key-generator → 256-bit, Base64.
4. **Save** → servis yenidən qurulur. **Logs**-da `Server running` və miqrasiyaların
   uğurla keçdiyini görməlisiniz.
5. Yoxlama: brauzerdə `https://hackos-api.onrender.com/health` açın →
   `{"status":"ok", ...}` görünməlidir. (Ünvan servisin səhifəsində yuxarıda yazılıb.)

> Pulsuz Render 15 dəqiqə istifadəsiz qalanda yatır, ilk sorğu ~50 saniyə çəkir.
> Demo/video çəkməzdən 2 dəqiqə əvvəl `/health` linkini açın ki, oyansın.

---

## 3. Vercel — frontend

1. https://vercel.com → **Add New** → **Project** → `hack-os-ai-hackaton` reposunu **Import** edin.
2. **Root Directory** → **Edit** → `frontend` seçin. Framework avtomatik **Next.js** olacaq.
3. **Environment Variables**:

   | Dəyişən | Dəyər |
   | --- | --- |
   | `NEXT_PUBLIC_API_URL` | Render ünvanı, məs. `https://hackos-api.onrender.com` (sonunda `/` olmadan) |

4. **Deploy**. Bitəndə ünvanı kopyalayın, məs. `https://hack-os-ai-hackaton.vercel.app`.

> `NEXT_PUBLIC_API_URL` build zamanı koda yazılır: onu dəyişsəniz, **Redeploy** edin.

---

## 4. İkisini bir-birinə bağlamaq

Render → **Environment**:

| Dəyişən | Dəyər |
| --- | --- |
| `FRONTEND_URL` | Vercel ünvanı, məs. `https://hack-os-ai-hackaton.vercel.app` |
| `FRONTEND_URLS` | eyni ünvan |
| `APP_ORIGIN` | eyni ünvan |

**Save** → yenidən qurulmasını gözləyin. `COOKIE_DOMAIN`-i boş buraxın: frontend API-ni
öz ünvanı üzərindən ötürür (`/api/*`), ona görə cookie Vercel domenində qalır.

---

## 5. Sizin admin (platforma sahibi) hesabınız

Hesab yaratmaq üçün ən sadə yol — Supabase-in SQL redaktoru və ya kompüterinizdə skript.

**Variant A — kompüterinizdə (Node lazımdır):**
```
cd backend
npm ci
DATABASE_URL="Supabase URI" npm run create-admin -- siz@example.com "GüclüParol123!" "Adınız"
```
(Windows PowerShell-də: `$env:DATABASE_URL="..."; npm run create-admin -- siz@example.com "GüclüParol123!" "Adınız"`)

Sonra hesabı platforma sahibi edin — Render → **Environment**:
```
BOOTSTRAP_SUPERADMIN_EMAIL=siz@example.com
```
Save → **Logs**-da `admin → superadmin` sətrini görəndə dəyişəni silin.

**Variant B — Node yoxdursa:** saytda istənilən yolla hesab yaradın, sonra Supabase →
**SQL Editor**:
```sql
UPDATE users SET role = 'superadmin' WHERE LOWER(email) = 'siz@example.com';
```

Ətraflı: `backend/docs/OWNER_SETUP.md`.

---

## 6. Yoxlama siyahısı

- [ ] `https://<render>/health` → `ok`
- [ ] Vercel saytı açılır
- [ ] Admin hesabla daxil olmaq olur
- [ ] `https://<vercel>/api/ai/status` (daxil olmuş halda) → `"enabled": true`
- [ ] Yeni event draft yaratmaq işləyir

## Problemlər

| Görünən | Səbəb |
| --- | --- |
| Vercel build: `NEXT_PUBLIC_API_URL is not set` | 3-cü addımdakı dəyişən yoxdur → əlavə edib Redeploy |
| Render logs: `FATAL: Missing required environment variable` | adı yazılan dəyişəni əlavə edin |
| Render logs: `DATA_ENCRYPTION_KEY must be 32 bytes` | açarı yenidən yaradın (base64, 32 bayt) |
| Girişdən sonra yenə login səhifəsi | `FRONTEND_URL(S)` Vercel ünvanı ilə eyni deyil |
| `AI_NOT_CONFIGURED` | Render-də `MODEL_API_KEY` yoxdur |
| `AI_UPSTREAM_ERROR` | açar və ya model adı səhvdir → Render logs-da `[metaAi] HTTP ...` sətrinə baxın |

## E-poçt (sonraya qalsa da olar)

Dəvətlər və şifrə bərpası üçün e-poçt lazımdır. Render-in pulsuz planı SMTP-ni bloklayır, ona görə
**Resend** (https://resend.com) işlədin: `RESEND_API_KEY` və təsdiqlənmiş domendən `MAIL_FROM_EMAIL`.
Ətraflı: `backend/docs/EMAIL.md`. Demo üçün vacib deyil.
