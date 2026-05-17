# Backup runbook — Chaudhary Farm CRM

Updated by the hardening pass on 2026-05-14. Owner: nicolussignin@gmail.com.

## Why this exists
Before any schema migration or destructive operation, we keep a fresh
backup we know we can restore from. "Backup we never tested" is no backup.

---

## How to take a backup (Supabase web dashboard)

1. Sign in to https://supabase.com/dashboard.
2. Pick the project `cmtxyiwpwknhzpdvqght`.
3. **Database → Backups**.
4. If you're on a paid tier: backups are automatic, listed daily. Note
   the most-recent backup's UTC timestamp.
5. If you're on free tier: download a manual dump via
   **Database → Connect → Connection string** + run:
   ```
   pg_dump --host db.cmtxyiwpwknhzpdvqght.supabase.co \
           --port 5432 --username postgres \
           --no-owner --no-privileges --clean --if-exists \
           --file=cf_backup_$(date -u +%Y%m%dT%H%M%SZ).sql
   ```
6. Store the resulting file somewhere outside your laptop (iCloud Drive,
   Google Drive, a USB stick — anywhere not the same machine running
   the app).

---

## How to restore (only if needed)

> Run against a TEST database first. Never restore directly over prod
> without verifying the file works.

1. Spin up a throwaway Postgres (Docker is easiest: `docker run -p 5433:5432 -e POSTGRES_PASSWORD=test postgres:15`).
2. Restore: `psql -h localhost -p 5433 -U postgres < cf_backup_*.sql`.
3. Spot-check three things:
   - `SELECT COUNT(*) FROM customers WHERE archived_at IS NULL;` matches the count you saw before the backup
   - `SELECT COUNT(*) FROM orders;` matches
   - `SELECT name, role, active FROM staff_users;` shows Owner + the staff PIN(s)
4. If the spot check passes, the backup is good. If not, **stop the
   hardening migration** and figure out what's wrong before touching prod.

---

## Backup log (fill in each time)

| Date (UTC) | Backup type | Location | Verified restorable? |
|---|---|---|---|
|  |  |  |  |

---

## What NOT to do
- Don't run any `scripts/migrations/*` against prod until a current backup
  is in this log AND verified restorable.
- Don't keep backups indefinitely on the same machine that runs the app.
- Don't share the dump file — it contains every customer record, phone
  numbers, and audit history. Treat it like the customer list it is.
