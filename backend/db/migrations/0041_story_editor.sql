-- The stories editor, rebuilt (Phase 11).
--
-- status 'scheduled' + publish_at: a story set to go public at a time. A job
--   (showcase.publish) publishes it then; until the job runs, the public
--   reads already treat a scheduled story whose time has come as published,
--   so a sleeping worker never holds a story back.
-- body_format: 'plain' is the original text (paragraphs split by blank
--   lines, nothing else means anything). 'rich' adds a small, safe markup the
--   new editor writes: ## and ### headings, - and 1. lists, > quotes,
--   ![caption](photo) images, [text](link) links, **bold**, *italic* and ---.
--   Every story written before this keeps 'plain', so no old text changes
--   meaning; a story becomes 'rich' when it is saved from the new editor.
-- cover_focus: the point of the cover that stays in frame when a card crops
--   it, { x, y } in percent.
-- tags, author_name, seo_title / seo_description ({ az, en, ru }).
--
-- Additive and safe to run twice.

ALTER TABLE showcase_posts ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ;
ALTER TABLE showcase_posts ADD COLUMN IF NOT EXISTS body_format VARCHAR(10) NOT NULL DEFAULT 'plain';
ALTER TABLE showcase_posts ADD COLUMN IF NOT EXISTS cover_focus JSONB NOT NULL DEFAULT '{"x":50,"y":50}'::jsonb;
ALTER TABLE showcase_posts ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE showcase_posts ADD COLUMN IF NOT EXISTS author_name VARCHAR(120);
ALTER TABLE showcase_posts ADD COLUMN IF NOT EXISTS seo_title JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE showcase_posts ADD COLUMN IF NOT EXISTS seo_description JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE showcase_posts DROP CONSTRAINT IF EXISTS showcase_posts_status_chk;
ALTER TABLE showcase_posts ADD CONSTRAINT showcase_posts_status_chk
  CHECK (status IN ('draft', 'scheduled', 'published'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'showcase_posts_body_format_chk') THEN
    ALTER TABLE showcase_posts ADD CONSTRAINT showcase_posts_body_format_chk CHECK (body_format IN ('plain', 'rich'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'showcase_posts_schedule_chk') THEN
    ALTER TABLE showcase_posts ADD CONSTRAINT showcase_posts_schedule_chk
      CHECK (status <> 'scheduled' OR publish_at IS NOT NULL);
  END IF;
END $$;

-- The public reads: published, or scheduled and due.
DROP INDEX IF EXISTS idx_showcase_posts_public;
CREATE INDEX IF NOT EXISTS idx_showcase_posts_public
  ON showcase_posts (held_from DESC NULLS LAST, published_at DESC) WHERE status IN ('published', 'scheduled');
