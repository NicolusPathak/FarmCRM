-- 07_session_version.sql — Invalidate existing sessions on revoke + PIN reset.
--
-- The session cookie is a stateless signed JWT-like blob. Before this
-- migration, verifySession only checked the HMAC + expiry, never the DB.
-- That meant revoking a staff PIN or resetting it didn't kick the user
-- out — their existing browser tab could keep operating for up to 30 days
-- until the cookie naturally expired.
--
-- Fix: every user row carries a `session_version` counter. The counter is
-- stamped into the cookie at login time. On every authenticated request,
-- the server compares the cookie's version to the row's current version
-- and rejects the session if they differ. Revoke / reset bumps the
-- counter, instantly invalidating every outstanding cookie for that user.

ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS session_version int NOT NULL DEFAULT 0;

ALTER TABLE owner_credentials
  ADD COLUMN IF NOT EXISTS session_version int NOT NULL DEFAULT 0;
