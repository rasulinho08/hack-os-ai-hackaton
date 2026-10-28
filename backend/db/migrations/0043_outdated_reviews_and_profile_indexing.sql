-- Two small additions.
--
-- 1. Publishing results over outdated reviews. When a team changed its
--    project after a judge's review (rolling judging, or a late change), the
--    API asks the organiser to confirm before publishing. The confirmation
--    stays with the publication: how many reviews were outdated, which
--    judges and teams, who confirmed and when. NULL when nothing was
--    outdated. Unpublishing clears it with the rest of the publication.
--
-- 2. Being found by search engines. A public profile (/u/<handle>) is
--    shared by its link and asks search engines not to index it. Its owner
--    may now also let them: `indexable` (off by default, only while the
--    profile itself is on) makes the page indexable and lists it in the
--    sitemap; `indexable_changed_at` is when that last changed.
--
-- Additive and safe to run twice.

ALTER TABLE events ADD COLUMN IF NOT EXISTS results_outdated_confirmation JSONB;

ALTER TABLE public_profiles ADD COLUMN IF NOT EXISTS indexable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public_profiles ADD COLUMN IF NOT EXISTS indexable_changed_at TIMESTAMPTZ;

-- The sitemap reads the indexable profiles.
CREATE INDEX IF NOT EXISTS idx_public_profiles_indexable ON public_profiles (updated_at DESC) WHERE enabled AND indexable;
