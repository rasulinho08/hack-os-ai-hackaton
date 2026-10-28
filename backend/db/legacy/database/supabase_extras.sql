-- 1. QİYMƏTLƏNDİRMƏ VƏ JÜRİ SİSTEMİ ÜÇÜN (Judging)
--
-- ⚠ NOT the production schema for hackatonhbtnback-end-6. The running Node API
-- uses `db_init.sql`: table `scoring_criteria` (integer ids) and `scores` with
-- `judges.id` / `criterion_id`. This file’s `evaluation_criteria` + UUID `scores`
-- are an alternate sketch — do not apply alongside `db_init.sql` on the same DB
-- or you will get conflicting / duplicate table definitions.
--
-- Meyarlar (Məsələn: Dizayn, İdeya, Texniki icra)
CREATE TABLE evaluation_criteria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    max_score INT DEFAULT 10,
    weight DECIMAL(3,2) DEFAULT 1.0, -- Bəzi meyarlar daha vacib ola bilər
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Hər jürinin submission-lara verdiyi xallar
CREATE TABLE scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    judge_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    criteria_id UUID NOT NULL REFERENCES evaluation_criteria(id) ON DELETE CASCADE,
    score INT NOT NULL CHECK (score >= 0),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (submission_id, judge_id, criteria_id)
);

-- 2. MENTORLAR VƏ BACARIQLAR ÜÇÜN
-- Mentorların hansı sahələrdə kömək edə biləcəyini göstərir (məsələn: React, Python, UI/UX)
CREATE TABLE mentor_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (mentor_id, skill_name)
);

-- 3. SPONSORLAR VƏ MÜKAFATLAR (Prizes & Tracks)
-- Hackathon sponsorları
CREATE TABLE sponsors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    logo_url VARCHAR(255),
    website_url VARCHAR(255),
    tier VARCHAR(50) DEFAULT 'partner', -- Məsələn: gold, silver, bronze
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Mükafatlar və kateqoriyalar (Tracks)
CREATE TABLE prizes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    sponsor_id UUID REFERENCES sponsors(id) ON DELETE SET NULL, -- Hansı sponsor verir
    title VARCHAR(255) NOT NULL, -- Məsələn: "Ən yaxşı FinTech layihəsi"
    description TEXT,
    reward_value VARCHAR(255), -- "1000 AZN" və ya "MacBook Air"
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. ƏLAVƏ İNFORMASİYA VƏ AUDİT
-- Qeydiyyatdan keçdikdən sonra tez-tez verilən suallar (FAQ)
CREATE TABLE faqs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category VARCHAR(100) DEFAULT 'general',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Hackathon daxilində baş verən önəmli hərəkətlərin log-u (Audit Trail)
-- Məsələn: "İstifadəçi komanda yaratdı", "Layihə yükləndi"
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    details JSONB, -- Supabase üçün JSONB ideal formatdır
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
