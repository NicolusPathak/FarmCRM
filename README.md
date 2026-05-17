# Chaudhary Farm CRM

A small private CRM + POS for a meat shop in Haslet, Texas.
Next.js 16 (App Router) + Supabase Postgres.

## Where to look

- **Developers:** see [DEVELOPER_NOTES.md](DEVELOPER_NOTES.md) — env vars, migration history, RPC inventory, regression-test runner, known gaps, monitoring plan.
- **Owner:** see [OWNER_GUIDE.md](OWNER_GUIDE.md) — plain-English manual for daily use, troubleshooting, and getting data out.
- **Backup / restore:** see [BACKUP.md](BACKUP.md).

## Getting started (dev)

```bash
npm install
npm run dev
# open http://localhost:3000
# default admin PIN: 9851  (rotate before production)
```

Tests:

```bash
# Boot dev server first, then:
bash tests/regression/run-all.sh           # Phase 1 — input validation
bash tests/regression/phase2_audit_meta.sh # Phase 2 — audit metadata
bash tests/regression/export/run.sh        # Phase 3 — CSV exports
bash tests/regression/payment/run.sh       # payment_method
bash tests/regression/today_sales/run.sh   # today's sales + TZ + DST
bash tests/regression/patch_audit/run.sh   # PATCH compensating rollback
```

Last full run: **87 / 87 PASS** (2026-05-14).
