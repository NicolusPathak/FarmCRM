-- 05_owner.sql — Owner ("Hero") login with username/password, separate from the
-- PIN-based staff login. Exactly one row is expected; the setup script
-- `npm run create-owner` writes/overwrites it.

CREATE TABLE IF NOT EXISTS owner_credentials (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  username       text        NOT NULL UNIQUE,
  password_hash  text        NOT NULL,                -- bcrypt hash
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

-- Tag login_attempts so we can rate-limit owner-login independently from PIN login.
-- 'pin' is the legacy value for the staff PIN endpoint.
ALTER TABLE login_attempts
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'pin';

CREATE INDEX IF NOT EXISTS idx_login_attempts_kind_ip_time
  ON login_attempts (kind, ip, failed_at DESC);
