-- People's choice (J1): each admitted participant may vote for one project
-- of another team; the vote can be changed or withdrawn until results are
-- published. Counts are for the organiser, who may give a special prize.
CREATE TABLE IF NOT EXISTS people_choice_votes (
  event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_people_choice_submission ON people_choice_votes (submission_id);
