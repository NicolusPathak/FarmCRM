-- ============================================================
-- schema.sql  —  Prime Cut Meat Shop Database
-- Run this entire file in Supabase → SQL Editor
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE throughout
-- ============================================================


-- ╔══════════════════════════════════════════════════════════╗
-- ║  STEP 1 — SEQUENCES                                     ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE SEQUENCE IF NOT EXISTS customer_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS order_number_seq    START 1;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  STEP 2 — TABLES                                        ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS customers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_number  text        UNIQUE NOT NULL,
  full_name        text        NOT NULL,
  phone_number     text,
  street           text,
  city             text,
  zip_code         text,
  points_balance   integer     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz
);

-- Idempotent migration for existing databases
ALTER TABLE customers ADD COLUMN IF NOT EXISTS archived_at        timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_contacted_at  timestamptz;
-- Tracks which staff member last reached out (no FK; app-level integrity only).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contacted_by_id    uuid;
CREATE INDEX IF NOT EXISTS idx_customers_last_contacted ON customers (last_contacted_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_customers_phone   ON customers (phone_number);
CREATE INDEX IF NOT EXISTS idx_customers_number  ON customers (customer_number);
CREATE INDEX IF NOT EXISTS idx_customers_created ON customers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_name    ON customers (full_name);
CREATE INDEX IF NOT EXISTS idx_customers_active  ON customers (created_at DESC) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS orders (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number   text          UNIQUE NOT NULL,
  customer_id    uuid          NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_date     timestamptz   NOT NULL DEFAULT now(),
  subtotal       numeric(10,2) NOT NULL DEFAULT 0,
  total          numeric(10,2) NOT NULL DEFAULT 0,
  points_earned  integer       NOT NULL DEFAULT 0,
  notes          text,
  status         text          NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  change_log     jsonb         NOT NULL DEFAULT '[]'::jsonb,
  created_at     timestamptz   NOT NULL DEFAULT now()
);

-- Idempotent migration for existing databases
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status     text  NOT NULL DEFAULT 'active';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS change_log jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('active','void'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- `created_by_name` is the denormalized snapshot — added here so it
-- exists before staff_users is created. The matching FK column
-- (`created_by`) is added later in STEP 5, after staff_users exists.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_by_name text;

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created     ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status      ON orders (status);

CREATE TABLE IF NOT EXISTS order_items (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_name   text          NOT NULL,
  quantity    numeric(10,3) NOT NULL,
  unit_price  numeric(10,2) NOT NULL,
  line_total  numeric(10,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);


-- ╔══════════════════════════════════════════════════════════╗
-- ║  STEP 3 — FUNCTIONS                                     ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION get_next_customer_number()
RETURNS text LANGUAGE sql AS $$
  SELECT 'CUST-' || LPAD(nextval('customer_number_seq')::text, 4, '0');
$$;

CREATE OR REPLACE FUNCTION get_next_order_number()
RETURNS text LANGUAGE sql AS $$
  SELECT 'ORD-' || LPAD(nextval('order_number_seq')::text, 4, '0');
$$;

CREATE OR REPLACE FUNCTION increment_points(customer_id_input uuid, points_to_add integer)
RETURNS void LANGUAGE sql AS $$
  UPDATE customers
  SET points_balance = points_balance + points_to_add
  WHERE id = customer_id_input;
$$;

CREATE OR REPLACE FUNCTION compute_line_total()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.line_total := ROUND((NEW.quantity * NEW.unit_price)::numeric, 2);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sync_order_totals()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_order_id uuid;
  v_subtotal numeric(10,2);
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  SELECT COALESCE(SUM(line_total), 0) INTO v_subtotal
  FROM order_items WHERE order_id = v_order_id;
  UPDATE orders
  SET subtotal      = v_subtotal,
      total         = v_subtotal,
      points_earned = FLOOR(v_subtotal)
  WHERE id = v_order_id;
  RETURN NULL;
END;
$$;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  STEP 4 — TRIGGERS                                      ║
-- ╚══════════════════════════════════════════════════════════╝

DROP TRIGGER IF EXISTS trg_compute_line_total ON order_items;
CREATE TRIGGER trg_compute_line_total
  BEFORE INSERT OR UPDATE OF quantity, unit_price ON order_items
  FOR EACH ROW EXECUTE FUNCTION compute_line_total();

DROP TRIGGER IF EXISTS trg_sync_order_totals ON order_items;
CREATE TRIGGER trg_sync_order_totals
  AFTER INSERT OR UPDATE OR DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION sync_order_totals();


-- ╔══════════════════════════════════════════════════════════╗
-- ║  STEP 5 — STAFF & AUDIT TABLES                          ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS staff_users (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  -- pin_hash is NOT declared UNIQUE inline. We use a partial unique index
  -- below so archived rows can keep their old hash (PIN-reset flow leaves
  -- the archived row with the old hash intact; the new active row may
  -- legitimately reuse a hash that some archived row also has).
  pin_hash    text        NOT NULL,
  role        text        NOT NULL CHECK (role IN ('admin','staff')),
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        REFERENCES staff_users(id),
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_staff_users_active ON staff_users (active) WHERE archived_at IS NULL;

-- Older databases may have a full-table unique constraint/index on pin_hash
-- from prior schema versions. Drop both before creating the partial index —
-- a full unique index would (a) block the partial-index creation if
-- duplicates exist among archived rows, and (b) wrongly forbid hash reuse
-- on PIN reset. IF EXISTS keeps this a no-op on fresh installs.
ALTER TABLE staff_users DROP CONSTRAINT IF EXISTS staff_users_pin_hash_key;
DROP INDEX IF EXISTS staff_users_pin_hash_key;

-- Partial unique index: pin_hash must be unique only across ACTIVE staff.
-- This matches the app's collision check in /api/staff (it filters
-- archived_at IS NULL when looking for existing PINs). It also lets the
-- seed INSERT below target the index via ON CONFLICT (pin_hash) WHERE
-- archived_at IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS staff_users_pin_hash_active_key
  ON staff_users (pin_hash) WHERE archived_at IS NULL;

-- Order creator FK. Lives here (not in STEP 2) because it references
-- staff_users(id), which is created above. ON DELETE SET NULL keeps the
-- order intact when a staff_users row is removed — created_by_name still
-- holds the snapshot name.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES staff_users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS audit_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid        REFERENCES staff_users(id) ON DELETE SET NULL,
  actor_name    text        NOT NULL,
  actor_role    text        NOT NULL,
  action        text        NOT NULL,   -- e.g. 'created','updated','voided','archived','restored','pin_created','pin_revoked'
  entity_type   text        NOT NULL,   -- 'customer' | 'order' | 'staff'
  entity_id     uuid,
  entity_label  text,                   -- e.g. customer name or order number for quick scanning
  changes       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity  ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor   ON audit_log (actor_id);

-- Failed-PIN tracker for lockout (max 3 attempts per IP in a 15-min window)
CREATE TABLE IF NOT EXISTS login_attempts (
  id         bigserial   PRIMARY KEY,
  ip         text        NOT NULL,
  failed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts (ip, failed_at DESC);

-- Per-shop tunable settings (retention thresholds, etc).
CREATE TABLE IF NOT EXISTS app_settings (
  key         text        PRIMARY KEY,
  value       jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES staff_users(id) ON DELETE SET NULL
);

-- Default retention thresholds. Admin can adjust via /admin/settings.
INSERT INTO app_settings (key, value) VALUES
  ('retention', jsonb_build_object(
    'cold_days', 40,
    'one_time_days', 30,
    'slipping_avg_gap_cap', 25,
    'slipping_multiplier', 1.75,
    'contacted_suppress_days', 14
  ))
ON CONFLICT (key) DO NOTHING;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  STEP 6 — ROW LEVEL SECURITY                            ║
-- ╚══════════════════════════════════════════════════════════╝
-- All app DB access goes through the service-role key (server-side),
-- which bypasses RLS. We still enable RLS to deny direct anon access.

ALTER TABLE customers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_users_customers"   ON customers;
DROP POLICY IF EXISTS "authenticated_users_orders"      ON orders;
DROP POLICY IF EXISTS "authenticated_users_order_items" ON order_items;
DROP POLICY IF EXISTS "authenticated_users_staff_users" ON staff_users;
DROP POLICY IF EXISTS "authenticated_users_audit_log"   ON audit_log;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  STEP 7 — SEED ADMIN (PIN 9851)                         ║
-- ╚══════════════════════════════════════════════════════════╝
-- HMAC-SHA256(PIN_SECRET, '9851') base64url-encoded.
-- Tied to PIN_SECRET in .env.local — if you rotate the secret,
-- regenerate this hash with:
--   node --env-file=.env.local -e "const c=require('crypto');\
--     console.log(c.createHmac('sha256', process.env.PIN_SECRET).update('9851')\
--     .digest('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_'))"

-- Ensure created_by can be safely SET NULL when an admin row is removed,
-- so re-runs and admin revocations don't trip the FK on referencing staff rows.
ALTER TABLE staff_users DROP CONSTRAINT IF EXISTS staff_users_created_by_fkey;
ALTER TABLE staff_users
  ADD CONSTRAINT staff_users_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES staff_users(id) ON DELETE SET NULL;

-- Seed the Owner admin — name-based identity, not hash-based.
-- Rationale: a PIN can be reset through the app, but the staff *name* is
-- stable. Keying on pin_hash would mean every schema re-run resets the
-- Owner's PIN back to 9851 (and clobbers any reset done in production).
-- Instead: only insert when no active Owner exists. Re-runs are a no-op.
-- The second NOT EXISTS guards against the (unlikely) case where some
-- *other* active staff already holds the 9851 hash — without it, the
-- partial unique index on pin_hash would 23505 the insert.
INSERT INTO staff_users (name, pin_hash, role, active)
SELECT 'Owner', '2zCUtBsuvKV8BmjOWxdtB7EANN-Mde19MiAeaKzOfbM', 'admin', true
WHERE NOT EXISTS (
  SELECT 1 FROM staff_users
  WHERE name = 'Owner' AND role = 'admin' AND archived_at IS NULL
)
AND NOT EXISTS (
  SELECT 1 FROM staff_users
  WHERE pin_hash = '2zCUtBsuvKV8BmjOWxdtB7EANN-Mde19MiAeaKzOfbM'
    AND archived_at IS NULL
);


-- ╔══════════════════════════════════════════════════════════╗
-- ║  DONE                                                   ║
-- ╚══════════════════════════════════════════════════════════╝
SELECT 'Schema installed successfully — admin PIN 9851 seeded.' AS status;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  BULK IMPORT HELPER                                     ║
-- ║  Reserves N customer numbers in one round-trip          ║
-- ║  Returns array like ["CUST-0001","CUST-0002",...]       ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION reserve_customer_numbers(n integer)
RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE
  first_val bigint;
  result    text[];
BEGIN
  -- Advance the sequence by n and capture the first value in that range
  SELECT nextval('customer_number_seq') INTO first_val;
  -- Advance n-1 more times to reserve the rest of the range
  IF n > 1 THEN
    PERFORM setval('customer_number_seq',
      first_val + n - 1, true);
  END IF;
  -- Build the array from first_val to first_val + n - 1
  SELECT array_agg('CUST-' || LPAD(gs::text, 4, '0') ORDER BY gs)
  INTO result
  FROM generate_series(first_val, first_val + n - 1) AS gs;
  RETURN result;
END;
$$;

SELECT 'Bulk import helper installed.' AS status;
