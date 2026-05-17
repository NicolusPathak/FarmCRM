# Developer notes — Chaudhary Farm CRM

Audience: the next developer. Terse, technical.

---

## 1. Production environment

| Item | Value |
|---|---|
| Stack | Next.js 16 (App Router) + Supabase Postgres |
| Host | Vercel (or whatever the owner pointed `chaudharyfarm.com` at) |
| Supabase project ref | `cmtxyiwpwknhzpdvqght` |
| Shop timezone | `America/Chicago` (Texas). All date math + display in this TZ. |
| Auth model | PIN-based, HMAC-SHA256 signed session cookie (`cf_session`). Admin PIN `9851`. Staff PINs created by admin. |

**Required env vars** (Vercel → Project → Settings → Environment Variables):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` *(server-only — never expose to browser)*
- `SESSION_SECRET` *(48+ random bytes; rotating signs everyone out)*
- `PIN_SECRET` *(48+ random bytes; rotating invalidates every PIN)*
- `NEXT_PUBLIC_SHOP_TIMEZONE` *(default: `America/Chicago`)*

**Never put values in this file.** Rotation runbook is in `BACKUP.md` and at the top of `.env.local` (a copy of the latter ships in the repo with placeholder secrets).

---

## 2. Migration history

| File | Applied | Rollback |
|---|---|---|
| `scripts/schema.sql` | yes (initial bootstrap) | manual — drop tables, recreate from this file. |
| `scripts/migrations/01_phase1.sql` | **NOT APPLIED** — owner opted out | Commented block at bottom of the file. Pre-check (`scripts/precheck.json`) showed 0 violations at write time. App layer enforces the same rules. |
| `scripts/migrations/04_payment_method.sql` | yes — applied 2026-05-14 | Commented block at bottom: `ALTER TABLE orders DROP COLUMN IF EXISTS payment_method;` |

Migrations 02 and 03 were never created — Phase 2 (audit) and Phase 3 (export) shipped code-only.

---

## 3. RPC inventory

The app's audit pattern is **not** a Postgres RPC — it's a TypeScript helper. The DB still exposes these RPCs from the original schema:

| RPC | Signature | Used by |
|---|---|---|
| `get_next_customer_number()` | → `text` (e.g. `CUST-1487`) | `createCustomer`, `import` |
| `get_next_order_number()` | → `text` (e.g. `ORD-0047`) | `createOrder`, regression seeds |
| `increment_points(customer_id, delta)` | → `void` | `createOrder`, order edit, void, points-balance rollback |
| `reserve_customer_numbers(n)` | → `text[]` | bulk import only |

The "audit + mutation" transactional pattern lives in [lib/audit.ts](lib/audit.ts):
- `logAudit({...})` — best-effort; retries 3× then logs to console and continues.
- `logAuditOrFail({...})` — same retries, but throws on final failure.

Callers that pair the throw with a compensating rollback (which approximates a transaction):
- `lib/db.ts:createCustomer` — rollback: delete the just-inserted customer row.
- `lib/db.ts:createOrder` — rollback: delete `order_items` + `orders` shell, points only commit *after* audit succeeds.
- `app/api/customers/[id]/route.ts:DELETE` — rollback: `archived_at = NULL`.
- `app/api/customers/[id]/route.ts:PATCH` — rollback: restore every `EDITABLE_KEYS` field from the pre-edit snapshot.
- `app/api/orders/[id]/route.ts:PATCH` (void branch) — rollback: restore prior `status` + `change_log`, then reverse points last.
- `app/api/orders/[id]/route.ts:PATCH` (edit branch) — rollback: SET absolute `points_balance` from snapshot (no delta recomputation), restore order row, replace items with snapshot.

The export endpoints (`/api/export/*.csv`) call `logAuditOrFail` *before* streaming any byte; audit failure → 500 with no CSV body.

---

## 4. Regression test suite

```
tests/regression/
  ├── phase1_*.sh             — input validation (25 tests)
  ├── phase2_audit_meta.sh    — audit IP/UA capture (2 tests)
  ├── export/run.sh           — CSV export endpoints (29 tests)
  ├── payment/run.sh          — payment_method end-to-end (13 tests)
  ├── today_sales/run.sh      — dashboard panel + TZ math + DST (7 tests)
  ├── patch_audit/run.sh      — PATCH compensating rollback (11 tests)
  └── run-all.sh              — Phase 1 only (legacy entry point)
```

**Run everything:**
```bash
# Boot the dev server first.
cd /path/to/meat-shop
rm -rf .next
npm run dev &
# wait for "Ready in"
curl -s -c /tmp/cookie_admin.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"pin":"9851"}'
curl -s -c /tmp/cookie_staff.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"pin":"1111"}'

bash tests/regression/run-all.sh
bash tests/regression/phase2_audit_meta.sh
bash tests/regression/export/run.sh
bash tests/regression/payment/run.sh
bash tests/regression/today_sales/run.sh
bash tests/regression/patch_audit/run.sh
```

**Current pass count:** 87 / 87 (last run 2026-05-14).

---

## 5. Backup and restore

Procedure in `BACKUP.md`. Quick reference:

```bash
# Backup
pg_dump --host db.cmtxyiwpwknhzpdvqght.supabase.co \
        --port 5432 --username postgres \
        --no-owner --no-privileges --clean --if-exists \
        --file=cf_backup_$(date -u +%Y%m%dT%H%M%SZ).sql
```

Store at **two** locations (e.g. local SSD + Google Drive). Verify restore against a Docker Postgres before considering a backup good.

```bash
# Local restore test
docker run -d -p 5433:5432 -e POSTGRES_PASSWORD=test --name cf-restore postgres:15
psql -h localhost -p 5433 -U postgres < cf_backup_XXXX.sql
# Spot-check
psql -h localhost -p 5433 -U postgres -c "SELECT COUNT(*) FROM customers WHERE archived_at IS NULL;"
docker rm -f cf-restore
```

---

## 6. Known gaps (the honest list)

| # | Gap | Severity | Triggers a bite when | Fix hours |
|---|---|---|---|---|
| 1 | **PIN hashing is HMAC-SHA256, not bcrypt.** Deterministic — a leaked DB dump + leaked `PIN_SECRET` reveals every PIN via 10K trial computations. | Leak-dependent (medium). | DB dump and env both compromised. | 3 h (bcryptjs lib + transparent re-hash on next login). |
| 2 | **Phase 1 SQL constraints written but not deployed.** `CHECK` on `order_items` + unique index on `customers.phone_number` exist only as app-layer validation in `lib/db.ts`. | Low. | Direct DB writes or future code path bypassing `lib/db.ts`. | 5 min (apply `01_phase1.sql`). |
| 3 | **Phase 2 audit is app-layer, not Postgres RPC.** Robust against transient errors (retry+backoff+compensating rollback) but vulnerable to process-level crash between mutation commit and audit insert. | Medium. | Node process killed by host mid-request. | 8–10 h (write RPCs for all four hardened paths, swap call sites, regression). |
| 4 | **Session revocation is cookie-based, valid until expiry.** No server-side check on `staff_users.archived_at` per request. | Medium (HR risk). | Ex-staff PIN revoked but their cookie still valid for up to 30 days. | 3 h (add `revoked_at` check in `lib/auth.ts:getSession`). |
| 5 | **Role caching in cookie, doesn't refresh until re-login.** Admin demoted to staff retains admin powers until they sign out. | Medium. | Mid-shift role change. | 3 h (re-fetch role from `staff_users` per request, 5-min memo). |
| 6 | **Per-IP rate limit only on PIN login.** A shop behind NAT (one outbound IP) gets locked out as a unit when one staff member fumbles. | Low/medium UX. | 3 wrong PINs on same IP. | 2 h (per-pin-hash counter in `login_attempts`). |
| 7 | **Optimistic concurrency: not implemented.** Two staff editing the same customer in two tabs: last write wins, silent. | Low (single shop). | Two cashiers editing the same record. | 4 h (`updated_at` column + `If-Unmodified-Since`). |
| 8 | **Order create has no server-side idempotency.** Double-submit risk on slow networks. UI disables the button; that's it. | Low. | Network stalls + double-click. | 2 h (in-memory 60-second dedupe keyed by actor+body-hash). |
| 9 | **Phone search digit-only normalization.** Search query `(817) 555-9111` finds nothing; `8175559111` works. | Low UX. | Staff types the phone with the dashes the customer reads. | 1 h (normalize the query the same way we normalize the stored value). |
| 10 | **Receipt printing is `window.print()`.** No thermal-receipt page sizing, no escape sequences. | Cosmetic. | Owner wants a receipt on a Star printer. | 4 h (receipt-print stylesheet + printer-specific page size). |

---

## 7. Pre-deploy checklist

Before any change touches production:
- [ ] Backup taken (`BACKUP.md`) and **verified restorable** locally.
- [ ] Regression suite green (87/87 expected as of 2026-05-14).
- [ ] `npm run build` clean.
- [ ] If schema change: migration file checked in with pre-flight + commented rollback block.
- [ ] Migration applied to a staging Supabase first (free tier branch project — cheap and disposable).
- [ ] Vercel preview deploy smoke-tested against staging Supabase.
- [ ] If env vars changed: production env vars updated *before* the merge to main.
- [ ] Owner notified of any UX change before it lands (he should never be surprised by an interface he uses daily).

---

## 8. 30-day monitoring plan

| Cadence | Action |
|---|---|
| Daily | Skim `/admin/activity` for unexpected actor/action pairs. Look for `export.*` you didn't run. |
| Weekly | Take a fresh `pg_dump`. Verify-restore once a month against Docker Postgres. Save the verification log. |
| Weekly | Owner runs the three CSV exports (`/admin/export`) and saves to his Drive — that's his disaster-recovery. |
| Monthly | Review the "Known gaps" table above. Anything that bit this month? Anything more urgent than 3 months ago? |
| Quarterly | Rotate `SESSION_SECRET` (signs everyone out, harmless). |
| Annually | Rotate `PIN_SECRET` → regenerate every PIN hash → coordinate with owner to redistribute new PINs to staff. |

---

## Final regression matrix (2026-05-14 handover)

| Suite | Pass | Total |
|---|---|---|
| Phase 1 — input validation | 25 | 25 |
| Phase 2 — audit metadata | 2 | 2 |
| Phase 3 — CSV exports | 29 | 29 |
| Step 1 — payment_method | 13 | 13 |
| Step 2 — today's sales + TZ + DST | 7 | 7 |
| Step 3 — PATCH compensating rollback | 11 | 11 |
| **Total** | **87** | **87** |
