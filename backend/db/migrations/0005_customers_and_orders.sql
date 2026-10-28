-- =============================================================================
-- 0005_customers_and_orders.sql
-- The commercial side: who buys hackathons from us, and what they bought.
--
-- Purely additive. Nothing here alters or drops an existing table, so applying
-- it to a live database cannot lose a participant, a score or an event. The
-- link to `events` is the only place the two halves meet, and it is a nullable
-- reference — an order can exist before its event does, and deleting an event
-- leaves the order intact with a null instead of taking the sale with it.
--
-- Money is stored in minor units as BIGINT (qəpik for AZN, cents for USD).
-- Floating point cannot represent 0.1 exactly, and a rounding error in a
-- currency column is an invoice nobody can reconcile. NULL means "not priced
-- yet", which is different from zero and has to stay different.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- customers — the organisation, not the person
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  legal_name    VARCHAR(255),
  sector        VARCHAR(100),
  country       VARCHAR(100),
  city          VARCHAR(120),
  website       TEXT,
  vat_id        VARCHAR(60),
  billing_email VARCHAR(255),
  notes         TEXT,
  archived_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_name_lower
  ON customers (LOWER(name));

DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- customer_contacts — the people we deal with there
--
-- `user_id` is how a signed-in account is recognised as belonging to a
-- customer, which is what the account portal reads. It is nullable because a
-- billing contact does not necessarily hold a platform account.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_contacts (
  id          SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  full_name   VARCHAR(200),
  email       VARCHAR(255) NOT NULL,
  role_title  VARCHAR(120),
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_contacts_unique
  ON customer_contacts (customer_id, LOWER(email));
CREATE INDEX IF NOT EXISTS idx_customer_contacts_user
  ON customer_contacts (user_id) WHERE user_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_customer_contacts_updated_at ON customer_contacts;
CREATE TRIGGER trg_customer_contacts_updated_at BEFORE UPDATE ON customer_contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- orders — one purchase
--
-- `status` moves draft → pending → paid → delivered, with cancelled and
-- refunded as exits. It is a plain VARCHAR with a CHECK rather than an enum
-- type: adding a state to an enum needs a migration and a lock, and this list
-- will grow.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                SERIAL PRIMARY KEY,
  order_code        VARCHAR(40) NOT NULL UNIQUE,
  customer_id       INT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  event_id          INT REFERENCES events(id) ON DELETE SET NULL,
  purchaser_user_id INT REFERENCES users(id) ON DELETE SET NULL,

  plan              VARCHAR(40) NOT NULL,
  billing_period    VARCHAR(20) NOT NULL DEFAULT 'per_event',
  status            VARCHAR(30) NOT NULL DEFAULT 'draft',

  currency          CHAR(3) NOT NULL DEFAULT 'AZN',
  -- Minor units. NULL means not priced, which is not the same as free.
  amount_minor      BIGINT,
  tax_minor         BIGINT,

  placed_at         TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,

  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT orders_plan_chk
    CHECK (plan IN ('starter', 'professional', 'business', 'enterprise')),
  CONSTRAINT orders_billing_period_chk
    CHECK (billing_period IN ('per_event', 'annual')),
  CONSTRAINT orders_status_chk
    CHECK (status IN ('draft', 'pending', 'paid', 'delivered', 'cancelled', 'refunded')),
  CONSTRAINT orders_amount_nonneg_chk
    CHECK (amount_minor IS NULL OR amount_minor >= 0),
  CONSTRAINT orders_tax_nonneg_chk
    CHECK (tax_minor IS NULL OR tax_minor >= 0)
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_event    ON orders (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders (status);
-- One order per event: an event is delivered against a single sale.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_event_unique
  ON orders (event_id) WHERE event_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- order_status_history — who changed a sale, when, and from what
--
-- Money questions are asked months later. Without this the only record of an
-- order being marked paid is the row itself, which says the current state and
-- nothing about how it got there.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_status_history (
  id          SERIAL PRIMARY KEY,
  order_id    INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status   VARCHAR(30) NOT NULL,
  changed_by  INT REFERENCES users(id) ON DELETE SET NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order
  ON order_status_history (order_id, created_at DESC);
