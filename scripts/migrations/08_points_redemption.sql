-- 08_points_redemption.sql — Manual points redemption on orders + cleanup.
--
-- What changes:
--   1. Orders carry two new fields:
--        points_redeemed       — how many points the customer used on this order
--        redemption_discount   — dollar discount applied because of those points
--      Both default to 0; existing rows interpret as "no redemption".
--
--   2. The sync_order_totals trigger now subtracts the discount when
--      computing `total` and `points_earned`, so customers don't earn
--      points on the discounted portion (the "no double-dip" rule).
--      `total` is clamped to >= 0 so a runaway discount can't go negative.
--
--   3. Existing negative customer balances are zeroed out (they're the
--      result of a prior bug, not legitimate redemptions). Then a CHECK
--      constraint prevents future negatives.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS points_redeemed     integer       NOT NULL DEFAULT 0
    CHECK (points_redeemed >= 0),
  ADD COLUMN IF NOT EXISTS redemption_discount numeric(10,2) NOT NULL DEFAULT 0
    CHECK (redemption_discount >= 0);

-- Replace the trigger to account for the discount. Same arithmetic style as
-- before; new pieces are GREATEST(0, ...) for safety and the subtraction.
CREATE OR REPLACE FUNCTION sync_order_totals()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_order_id uuid;
  v_subtotal numeric(10,2);
  v_discount numeric(10,2);
  v_total    numeric(10,2);
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  SELECT COALESCE(SUM(line_total), 0) INTO v_subtotal
  FROM order_items WHERE order_id = v_order_id;

  SELECT COALESCE(redemption_discount, 0) INTO v_discount
  FROM orders WHERE id = v_order_id;

  v_total := GREATEST(0, v_subtotal - v_discount);

  UPDATE orders
  SET subtotal      = v_subtotal,
      total         = v_total,
      points_earned = FLOOR(v_total)
  WHERE id = v_order_id;
  RETURN NULL;
END;
$$;

-- Cleanup: zero out any customer with a negative balance. These came from
-- earlier bugs (the points-balance integer column had no CHECK), not from
-- legitimate redemptions. Audit log gets a row so the change is recorded.
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM customers WHERE points_balance < 0;
  IF v_count > 0 THEN
    UPDATE customers SET points_balance = 0 WHERE points_balance < 0;
    INSERT INTO audit_log (actor_id, actor_name, actor_role, action, entity_type, entity_label, changes)
    VALUES (NULL, 'system', 'admin', 'updated', 'customer', 'Negative balance cleanup',
            jsonb_build_object('customers_zeroed', v_count, 'reason', 'migration_08'));
  END IF;
END $$;

-- Future-proof: prevent negative balances at the DB level.
DO $$ BEGIN
  ALTER TABLE customers ADD CONSTRAINT customers_points_balance_nonneg CHECK (points_balance >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
