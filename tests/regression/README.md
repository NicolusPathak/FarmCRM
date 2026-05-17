# Regression tests

Each script in this folder proves one bug from the hardening audit is now
closed. Run them against a dev server signed in as admin (PIN 9851).

## Prerequisites
1. Migration `scripts/migrations/01_phase1.sql` has been applied to your DB.
2. Dev server is running: `npm run dev` (port 3000).
3. Admin cookie has been captured to `/tmp/cookie_admin.txt`:
   ```
   curl -s -c /tmp/cookie_admin.txt -X POST http://localhost:3000/api/auth/login \
     -H 'Content-Type: application/json' -d '{"pin":"9851"}'
   ```
4. Optional: staff cookie at `/tmp/cookie_staff.txt` (PIN 1111).

## Run all
```
bash tests/regression/run-all.sh
```

## Individual tests
- `phase1_1_negative_qty.sh` — reject negative / zero / oversize quantity + negative price
- `phase1_2_phone_unique.sh` — second customer with same phone returns 409 with the existing customer_number
- `phase1_3_archived_order.sh` — order against archived customer returns 400, not 500
- `phase1_4_optional_fields.sh` — POST with only full_name returns 201, not 500
- `phase1_4_error_leak.sh` — no API response contains Postgres or Node stack-trace strings
- `phase1_5_timezone.sh` — formatDate/formatDateTime render in SHOP_TIMEZONE
