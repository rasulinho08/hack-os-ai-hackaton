-- When a team last changed what it handed in (its texts, links or files), as
-- opposed to submissions.updated_at, which also moves when the judging status
-- is recomputed. A judge's review older than this is flagged "changed since
-- your review" until they look again. Rows from before this column existed
-- stay NULL: nothing is known to have changed after their reviews.
-- Additive and safe to run twice.

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS content_changed_at TIMESTAMPTZ;
ALTER TABLE submissions ALTER COLUMN content_changed_at SET DEFAULT now();
