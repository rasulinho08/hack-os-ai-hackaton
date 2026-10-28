-- Outgoing webhooks (plan module `webhooks`, Business and Enterprise).
--
-- An organisation registers HTTPS endpoints and picks the things it wants to
-- hear about. When one of them happens, a trigger writes a row to the
-- outbox in the same transaction as the change itself — a registration that
-- rolls back never announces itself, and every code path that creates a
-- participant, team or submission is covered without each one having to
-- remember. The worker turns outbox rows into one delivery per endpoint and
-- posts them, signed, with retries (webhook.service.js).
--
-- The triggers only write when the event's organisation has an active
-- endpoint for that kind of thing, so organisations without webhooks pay one
-- indexed lookup and nothing else. Additive only: the code that ran before
-- this migration works on a database that has it.

-- 1 ─────────────────────────────────────────────────────────────────────────
-- Endpoints. The URL and the signing secret are sealed with secretBox
-- (DATA_ENCRYPTION_KEY) — URLs of hosted automation tools often carry a token
-- in their path. url_host is what lists and notices show.
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id                   SERIAL PRIMARY KEY,
  customer_id          INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  url                  TEXT NOT NULL,
  url_host             VARCHAR(255) NOT NULL,
  description          VARCHAR(200),
  events               TEXT[] NOT NULL DEFAULT '{}',
  secret               TEXT NOT NULL,
  active               BOOLEAN NOT NULL DEFAULT true,
  consecutive_failures INT NOT NULL DEFAULT 0,
  disabled_reason      VARCHAR(40),
  disabled_at          TIMESTAMPTZ,
  last_delivery_at     TIMESTAMPTZ,
  last_delivery_status VARCHAR(12),
  secret_rotated_at    TIMESTAMPTZ,
  created_by           INT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_customer ON webhook_endpoints (customer_id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_active ON webhook_endpoints (customer_id) WHERE active;

-- 2 ─────────────────────────────────────────────────────────────────────────
-- What happened, waiting to be turned into deliveries. `data` holds the ids
-- (and a status) at the moment it happened; the worker adds names and
-- details when it builds the payload. uid is the payload's `id`, the same in
-- every endpoint's copy and in redeliveries, so receivers can de-duplicate.
-- A row whose payload could not be built is set aside with its `error` (so
-- it never holds up the rows after it); once the cause is fixed,
-- `UPDATE webhook_outbox SET processed_at = NULL, error = NULL WHERE error IS NOT NULL`
-- sends those too.
CREATE TABLE IF NOT EXISTS webhook_outbox (
  id           BIGSERIAL PRIMARY KEY,
  uid          UUID NOT NULL DEFAULT gen_random_uuid(),
  customer_id  INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  event_id     INT REFERENCES events(id) ON DELETE SET NULL,
  type         VARCHAR(40) NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  error        VARCHAR(500)
);
CREATE INDEX IF NOT EXISTS idx_webhook_outbox_pending ON webhook_outbox (id) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_outbox_processed ON webhook_outbox (processed_at) WHERE processed_at IS NOT NULL;

-- 3 ─────────────────────────────────────────────────────────────────────────
-- One payload for one endpoint, and how its delivery went. uid is sent as
-- X-HackOS-Delivery. A redelivery is a new row pointing at the one it repeats.
-- The payload is JSON, not JSONB, so it keeps the order it was written in:
-- what receivers log reads id, type, … data, and every attempt sends the
-- same bytes.
-- locked_at is set while an attempt is under way, so two workers never post
-- the same delivery at once.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id               BIGSERIAL PRIMARY KEY,
  uid              UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  endpoint_id      INT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  customer_id      INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  event_id         INT REFERENCES events(id) ON DELETE SET NULL,
  type             VARCHAR(40) NOT NULL,
  payload          JSON NOT NULL,
  status           VARCHAR(12) NOT NULL DEFAULT 'pending',
  attempts         INT NOT NULL DEFAULT 0,
  max_attempts     INT NOT NULL DEFAULT 6,
  last_status_code INT,
  last_error       VARCHAR(500),
  last_response    VARCHAR(1000),
  last_duration_ms INT,
  next_attempt_at  TIMESTAMPTZ,
  locked_at        TIMESTAMPTZ,
  redelivery_of    BIGINT REFERENCES webhook_deliveries(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at     TIMESTAMPTZ,
  CONSTRAINT webhook_deliveries_status_chk CHECK (status IN ('pending', 'delivered', 'failed'))
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint ON webhook_deliveries (endpoint_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created ON webhook_deliveries (created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';

-- 4 ─────────────────────────────────────────────────────────────────────────
-- Capture. search_path is pinned like the other trigger functions (0003), so
-- a restored dump resolves the tables.
CREATE OR REPLACE FUNCTION webhook_capture(p_event_id INT, p_type TEXT, p_data JSONB)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.webhook_outbox (customer_id, event_id, type, data)
  SELECT e.customer_id, e.id, p_type, p_data
    FROM public.events e
   WHERE e.id = p_event_id
     AND e.customer_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.webhook_endpoints w
                  WHERE w.customer_id = e.customer_id AND w.active
                    AND (p_type = ANY (w.events) OR '*' = ANY (w.events)));
END
$fn$;

-- A registration, and a participant accepted or turned down (on any path:
-- the organiser, bulk changes, the waiting list moving up, an invitation).
CREATE OR REPLACE FUNCTION webhook_on_participant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  d JSONB := jsonb_build_object('participant_id', NEW.id, 'user_id', NEW.user_id, 'status', lower(NEW.status::text));
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.webhook_capture(NEW.event_id, 'registration.created', d);
    IF lower(NEW.status::text) IN ('approved', 'rejected') THEN
      PERFORM public.webhook_capture(NEW.event_id, 'participant.' || lower(NEW.status::text), d);
    END IF;
  ELSIF lower(NEW.status::text) IN ('approved', 'rejected')
        AND lower(NEW.status::text) IS DISTINCT FROM lower(OLD.status::text) THEN
    PERFORM public.webhook_capture(NEW.event_id, 'participant.' || lower(NEW.status::text),
      d || jsonb_build_object('previous_status', lower(OLD.status::text)));
  END IF;
  RETURN NULL;
END
$fn$;
DROP TRIGGER IF EXISTS trg_webhook_participants ON participants;
CREATE TRIGGER trg_webhook_participants
  AFTER INSERT OR UPDATE OF status ON participants
  FOR EACH ROW EXECUTE FUNCTION webhook_on_participant();

CREATE OR REPLACE FUNCTION webhook_on_team()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  PERFORM public.webhook_capture(NEW.event_id, 'team.created', jsonb_build_object('team_id', NEW.id));
  RETURN NULL;
END
$fn$;
DROP TRIGGER IF EXISTS trg_webhook_teams ON teams;
CREATE TRIGGER trg_webhook_teams
  AFTER INSERT ON teams
  FOR EACH ROW EXECUTE FUNCTION webhook_on_team();

CREATE OR REPLACE FUNCTION webhook_on_submission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  PERFORM public.webhook_capture(NEW.event_id, 'submission.created',
    jsonb_build_object('submission_id', NEW.id, 'team_id', NEW.team_id));
  RETURN NULL;
END
$fn$;
DROP TRIGGER IF EXISTS trg_webhook_submissions ON submissions;
CREATE TRIGGER trg_webhook_submissions
  AFTER INSERT ON submissions
  FOR EACH ROW EXECUTE FUNCTION webhook_on_submission();

-- One row per certificate; the worker sends the certificates of one event
-- issued together as one delivery.
CREATE OR REPLACE FUNCTION webhook_on_certificate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  PERFORM public.webhook_capture(NEW.event_id, 'certificate.issued', jsonb_build_object('certificate_id', NEW.id));
  RETURN NULL;
END
$fn$;
DROP TRIGGER IF EXISTS trg_webhook_certificates ON certificates;
CREATE TRIGGER trg_webhook_certificates
  AFTER INSERT ON certificates
  FOR EACH ROW EXECUTE FUNCTION webhook_on_certificate();

-- The event going public, and results being published (the first time and
-- after each correction). An event created as published is put under its
-- organisation by a second statement (tenancy.service), so that counts too.
CREATE OR REPLACE FUNCTION webhook_on_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF COALESCE(NEW.is_published, false)
     AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.is_published, false)
          OR (OLD.customer_id IS NULL AND NEW.customer_id IS NOT NULL)) THEN
    PERFORM public.webhook_capture(NEW.id, 'event.published', '{}'::jsonb);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.results_published_at IS NOT NULL
     AND NEW.results_published_at IS DISTINCT FROM OLD.results_published_at THEN
    PERFORM public.webhook_capture(NEW.id, 'results.published',
      jsonb_build_object('first', OLD.results_published_at IS NULL));
  END IF;
  RETURN NULL;
END
$fn$;
DROP TRIGGER IF EXISTS trg_webhook_events ON events;
CREATE TRIGGER trg_webhook_events
  AFTER INSERT OR UPDATE OF is_published, results_published_at, customer_id ON events
  FOR EACH ROW EXECUTE FUNCTION webhook_on_event();
