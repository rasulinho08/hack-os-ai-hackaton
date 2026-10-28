-- Add presentation_link column to submissions table
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS presentation_link TEXT;

-- Add comment for documentation
COMMENT ON COLUMN submissions.presentation_link IS 'URL to project presentation (Google Slides, PDF, etc.)';
