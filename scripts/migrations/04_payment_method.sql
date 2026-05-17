-- ============================================================
-- Migration 04 — Add payment_method to orders
-- Date    : 2026-05-14
-- Scope   : Adds an enum-style payment_method column to orders.
-- Safety  : Additive, NOT NULL with DEFAULT 'cash'. Existing rows
--           backfill automatically via the DEFAULT. No data
--           transformation, no orphan risk.
-- Idempot.: Pre-flight raises if the column already exists.
-- Rollback: At the bottom (commented).
-- ============================================================

-- ╔══════════════════════════════════════════════════════════╗
-- ║  Pre-flight                                              ║
-- ╚══════════════════════════════════════════════════════════╝
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'payment_method'
  ) THEN
    RAISE EXCEPTION 'payment_method column already exists — nothing to do';
  END IF;
END $$;

-- ╔══════════════════════════════════════════════════════════╗
-- ║  Add the column                                          ║
-- ╚══════════════════════════════════════════════════════════╝
ALTER TABLE orders
  ADD COLUMN payment_method text NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash','card','zelle'));

-- ╔══════════════════════════════════════════════════════════╗
-- ║  Verify                                                  ║
-- ╚══════════════════════════════════════════════════════════╝
DO $$
DECLARE v_nulls bigint;
BEGIN
  SELECT COUNT(*) INTO v_nulls FROM orders WHERE payment_method IS NULL;
  IF v_nulls > 0 THEN
    RAISE EXCEPTION 'Found % orders with NULL payment_method after backfill', v_nulls;
  END IF;
END $$;

SELECT 'Migration 04 applied — payment_method column live.' AS status;

-- ╔══════════════════════════════════════════════════════════╗
-- ║  ROLLBACK (uncomment to revert)                          ║
-- ╚══════════════════════════════════════════════════════════╝
/*
  ALTER TABLE orders DROP COLUMN IF EXISTS payment_method;
*/
