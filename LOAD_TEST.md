# Load test — concurrency verification

The race-condition fixes in `createOrder` and `points-adjust` claim to be safe under contention. **Don't trust the claim. Verify before launch.**

This document is a self-contained script + repro plan. Run it against a non-production Supabase project (clone the schema, seed one customer with 1000 points, set the same env vars locally as Vercel uses).

---

## What we're testing

| Concern | Fix being verified |
|---|---|
| Concurrent redemption from one customer | createOrder's `increment_points` error check + order rollback |
| Concurrent manual points adjustment | atomic RPC + `CHECK (points_balance >= 0)` |
| Concurrent void on the same order | CAS on `status='active'` |
| Rate-limit bypass via header spoof | `clientIp` prefers `x-real-ip` then rightmost `X-Forwarded-For` |

Each scenario has a specific invariant the system must preserve under any concurrent ordering of requests.

---

## Setup

You need:
- A non-production Supabase project with all migrations applied (01-08).
- A test customer with a known balance (e.g. 1000 points). Note the UUID.
- A valid admin PIN that you can hash to a session cookie OR a session cookie issued by manual login.
- The dev server running locally (`npm run dev`) so you don't burn Vercel function invocations.

```bash
# Create the test customer in Supabase SQL editor:
INSERT INTO customers (customer_number, full_name, points_balance)
VALUES ('TEST-0001', 'Load Test Customer', 1000) RETURNING id;

# Grab the UUID from the result. Then export:
export TEST_CUST=<uuid-here>
export COOKIE='cf_session=<paste-your-session-cookie>'
export BASE=http://localhost:3000
```

---

## Scenario 1 — Concurrent redemption (CRITICAL fix verification)

**Invariant:** customer balance can never go negative. Total `points_redeemed` across successfully-saved orders ≤ starting balance.

**Setup:** customer has 1000 points. Run 20 parallel orders, each redeeming 100 points (so collectively trying to redeem 2000 points — twice the available balance).

Save this as `loadtest-redeem.sh`:

```bash
#!/usr/bin/env bash
set -u
BODY=$(cat <<JSON
{
  "customer_id": "$TEST_CUST",
  "notes": "load test",
  "items": [{"item_name": "Test", "quantity": 1, "unit_price": 5.00}],
  "payment_method": "cash",
  "points_redeemed": 100,
  "redemption_discount": 1.00
}
JSON
)

for i in {1..20}; do
  curl -s -X POST "$BASE/api/orders" \
    -H "Content-Type: application/json" \
    -H "Cookie: $COOKIE" \
    -d "$BODY" \
    -o /tmp/loadtest_$i.json \
    -w "%{http_code} " &
done
wait
echo

# Tally
echo "== Status counts =="
for i in {1..20}; do
  cat /tmp/loadtest_$i.json | jq -r '.error // "OK"' 2>/dev/null
done | sort | uniq -c
```

**Run it.** Then check the database:

```sql
-- How many orders made it through?
SELECT count(*) FROM orders
 WHERE customer_id = '<TEST_CUST>' AND notes = 'load test';

-- What's the customer's final balance?
SELECT points_balance FROM customers WHERE id = '<TEST_CUST>';

-- Sum of redemptions on saved orders
SELECT sum(points_redeemed) FROM orders
 WHERE customer_id = '<TEST_CUST>' AND notes = 'load test';
```

**PASS criteria:**
- Customer balance ≥ 0 (CHECK enforces this).
- Sum of `points_redeemed` on saved orders ≤ 1000 (starting balance).
- Of 20 requests, expect roughly 10 to succeed (1000 ÷ 100) and roughly 10 to come back with HTTP 409 "Customer does not have enough points." The exact split depends on race timing.
- Customer balance + sum(redeemed) = 1000 (within points-earned offset — net of `points_earned` on the saved orders).

**FAIL criteria:**
- Customer balance is negative → CHECK isn't doing its job.
- Sum of redeemed > 1000 with all orders persisted → the fix didn't work.
- HTTP 200 returned but no order row exists → rollback got out of sync.
- Order row exists but customer balance didn't decrement → the fix didn't apply.

**Cleanup:**
```sql
DELETE FROM orders WHERE customer_id = '<TEST_CUST>' AND notes = 'load test';
UPDATE customers SET points_balance = 1000 WHERE id = '<TEST_CUST>';
```

---

## Scenario 2 — Concurrent manual points adjustment

**Invariant:** sum of (delta) across successful adjustments = (final balance − initial balance).

Same customer (reset balance to 1000). Fire 20 concurrent `-50` adjustments. With 1000 starting, only the first 20 should succeed (1000 ÷ 50 = exactly 20), leaving balance at 0.

```bash
for i in {1..20}; do
  curl -s -X POST "$BASE/api/customers/$TEST_CUST/points" \
    -H "Content-Type: application/json" \
    -H "Cookie: $COOKIE" \
    -d '{"delta": -50, "reason": "load test"}' \
    -w "%{http_code} " &
done
wait
echo

# Check
psql ... -c "SELECT points_balance FROM customers WHERE id = '$TEST_CUST'"
psql ... -c "SELECT count(*) FROM audit_log WHERE entity_id = '$TEST_CUST' AND action = 'points_adjusted' AND created_at > now() - interval '1 minute'"
```

**PASS criteria:**
- Final balance = 0 (or 1000 - 50×successful_count if some failed).
- audit_log count = number of HTTP 200 responses (no audit drift).
- Balance can never be < 0.

**FAIL criteria:**
- Final balance > 0 with all requests reporting 200 (lost update — old bug).
- audit_log count ≠ 200 response count (audit-failure rollback didn't work or audit succeeded but RPC didn't).

Push it further: kick balance to 1, then fire 5 concurrent `-1` adjustments. Exactly one should succeed.

---

## Scenario 3 — Concurrent void on same order

**Invariant:** points reversal happens exactly once. Customer balance returns to pre-order state.

```bash
# Create one order with 100 redemption + 30 earned
ORDER_ID=$(curl -s -X POST "$BASE/api/orders" \
  -H "Content-Type: application/json" -H "Cookie: $COOKIE" \
  -d '{"customer_id":"'$TEST_CUST'","items":[{"item_name":"X","quantity":1,"unit_price":35.00}],"payment_method":"cash","points_redeemed":100,"redemption_discount":5.00}' \
  | jq -r .id)

# Now fire 5 concurrent voids
for i in {1..5}; do
  curl -s -X PATCH "$BASE/api/orders/$ORDER_ID" \
    -H "Content-Type: application/json" -H "Cookie: $COOKIE" \
    -d '{"action":"void"}' -w "%{http_code} " &
done
wait
echo
```

**PASS criteria:**
- One HTTP 200 (winner), four HTTP 409 (already voided).
- Order's `status = 'void'` exactly once.
- Customer balance reflects exactly one points refund + one points reversal (not multiplied).
- audit_log has exactly one `voided` row for this order.

**FAIL criteria:**
- More than one void succeeds (CAS broken).
- Customer balance multi-refunded.

---

## Scenario 4 — Rate-limit bypass

Test the IP-spoof bypass that was just fixed. Fire 10 wrong-PIN attempts from the SAME real client but with rotating `X-Forwarded-For` headers.

```bash
for i in {1..10}; do
  curl -s -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -H "X-Forwarded-For: $i.$i.$i.$i" \
    -d '{"pin":"0000"}' \
    -w "%{http_code} " &
done
wait
echo
```

**PASS criteria:**
- After 3 attempts, all subsequent requests return **429 Too many wrong PINs** (the spoofed header is ignored; the real IP/empty header is used).
- Mix of 401 (first 3) and 429 (remaining 7).

**FAIL criteria:**
- All 10 return 401 ("Invalid PIN. X attempts remaining") — means the spoofed header is still trusted.

**Note:** locally there's no real proxy setting `x-real-ip`, so the function will treat all 10 as coming from `'local'` and bucket them together. That's the right behavior — the test verifies that `X-Forwarded-For` isn't used to *split* them into separate buckets.

For a full prod-like test, deploy to a Vercel preview and run the same script against the preview URL. There, `x-real-ip` is your real connecting IP and `X-Forwarded-For` includes both Vercel's view and any spoofed value you sent. After 3 wrong attempts you'll see 429.

---

## When to run this

- **Before first prod deploy.** Run all four scenarios. Document PASS/FAIL inline as a row in this file.
- **After any change to:**
  - `lib/db.ts createOrder`
  - `app/api/orders/[id]/route.ts`
  - `app/api/customers/[id]/points/route.ts`
  - `lib/audit.ts`
  - `lib/request-ip.ts`
- **Quarterly** as a smoke test — concurrency bugs creep back when code is touched by an LLM agent that doesn't run them.

---

## Results log (fill in as you run)

| Date | Scenario | Result | Notes |
|---|---|---|---|
| YYYY-MM-DD | 1 (redemption) | PASS / FAIL | |
| YYYY-MM-DD | 2 (manual adjust) | PASS / FAIL | |
| YYYY-MM-DD | 3 (void) | PASS / FAIL | |
| YYYY-MM-DD | 4 (rate limit) | PASS / FAIL | |

If any row says FAIL, **do not launch.** Reopen the relevant audit finding.
