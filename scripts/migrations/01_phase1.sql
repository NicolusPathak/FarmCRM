-- ============================================================
-- Migration 01 — Phase 1 hardening
-- Date    : 2026-05-14
-- Scope   : Reject bad order inputs at the DB level + enforce phone uniqueness.
-- Safety  : Pre-check (scripts/precheck.json) showed 0 violations on every
--           constraint added below as of 2026-05-14. Re-run the pre-check
--           queries immediately before applying this to confirm still clean.
-- Idempot.: All statements are NOT-EXISTS / DROP-IF-EXISTS guarded.
-- Rollback: At the bottom of this file in a commented block.
-- ============================================================


-- ╔══════════════════════════════════════════════════════════╗
-- ║  Pre-flight assertions — fail fast if data has drifted   ║
-- ╚══════════════════════════════════════════════════════════╝
DO $$
DECLARE
  v_bad_qty   bigint;
  v_bad_price bigint;
  v_dup_phone bigint;
BEGIN
  SELECT COUNT(*) INTO v_bad_qty   FROM order_items WHERE quantity   <= 0;
  SELECT COUNT(*) INTO v_bad_price FROM order_items WHERE unit_price <  0;
  SELECT COUNT(*) INTO v_dup_phone FROM (
    SELECT phone_number FROM customers
     WHERE phone_number IS NOT NULL AND archived_at IS NULL
     GROUP BY phone_number HAVING COUNT(*) > 1
  ) s;

  IF v_bad_qty   > 0 THEN RAISE EXCEPTION 'Pre-flight: % order_items with quantity <= 0 — resolve first',   v_bad_qty;   END IF;
  IF v_bad_price > 0 THEN RAISE EXCEPTION 'Pre-flight: % order_items with unit_price < 0 — resolve first',  v_bad_price; END IF;
  IF v_dup_phone > 0 THEN RAISE EXCEPTION 'Pre-flight: % duplicate active phone numbers — resolve first',   v_dup_phone; END IF;
END $$;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  1.1  CHECK constraints on order_items                  ║
-- ╚══════════════════════════════════════════════════════════╝
DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT order_items_quantity_positive
    CHECK (quantity > 0 AND quantity <= 1000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT order_items_unit_price_nonneg
    CHECK (unit_price >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  1.2  Unique active phone numbers                       ║
-- ╚══════════════════════════════════════════════════════════╝
-- Partial unique index — NULL phones are allowed to duplicate,
-- archived customers are out of scope.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_active_phone
  ON customers (phone_number)
  WHERE phone_number IS NOT NULL AND archived_at IS NULL;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  DONE                                                   ║
-- ╚══════════════════════════════════════════════════════════╝
SELECT 'Phase 1 migration applied.' AS status;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  ROLLBACK (uncomment + run if you need to revert)       ║
-- ╚══════════════════════════════════════════════════════════╝
/*
  ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_quantity_positive;
  ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_unit_price_nonneg;
  DROP INDEX IF EXISTS uq_customers_active_phone;
*/
