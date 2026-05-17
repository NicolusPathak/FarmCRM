-- 06_pin_partial_unique.sql — Let revoked PINs be reused.
--
-- The original `pin_hash UNIQUE` was a column-level constraint that covered
-- EVERY row, including archived (revoked) ones. So once Alice's PIN was
-- revoked, no one could ever use that PIN again — even though Alice's row was
-- archived and her PIN couldn't sign her in. The app's pre-check filtered on
-- archived_at IS NULL, but the DB constraint didn't, so users saw a raw
-- "duplicate key" error when trying to reuse a freed PIN.
--
-- This migration drops the blanket UNIQUE and replaces it with a partial
-- UNIQUE INDEX that only enforces uniqueness across ACTIVE (non-archived)
-- rows. Archived rows can share a pin_hash with active ones, so revoked PINs
-- become reusable.
--
-- Security note: pin_hash on archived rows is still an HMAC over a secret
-- (PIN_SECRET), so an attacker reading the DB can't reverse it to the plain
-- 4-digit PIN. Leaving it on archived rows is fine.

ALTER TABLE staff_users
  DROP CONSTRAINT IF EXISTS staff_users_pin_hash_key;

CREATE UNIQUE INDEX IF NOT EXISTS staff_users_pin_hash_active_uq
  ON staff_users (pin_hash)
  WHERE archived_at IS NULL;
