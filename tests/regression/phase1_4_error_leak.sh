#!/usr/bin/env bash
# Regression: Phase 1.4 — provoke various error paths and confirm no Postgres or Node strings leak.
set -u
B=${B:-http://localhost:3000}
ADM=${ADM:-/tmp/cookie_admin.txt}
FAIL=0

bad_strings='Cannot read properties|undefined|TypeError|at async|at Object|psql|relation "|column "|duplicate key|violates|constraint "'

check() {
  local label="$1"; local body="$2"
  if echo "$body" | grep -qE "$bad_strings"; then
    echo "  FAIL  $label leaks internals: $body"
    FAIL=1
  else
    echo "  PASS  $label: clean error"
  fi
}

# Send malformed JSON to customer create
RES=$(curl -s -b "$ADM" -X POST "$B/api/customers" -H 'Content-Type: application/json' -d 'not-json')
check "POST /api/customers malformed JSON" "$RES"

# Create order with bad customer_id
RES=$(curl -s -b "$ADM" -X POST "$B/api/orders" -H 'Content-Type: application/json' -d '{"customer_id":"not-a-uuid","items":[{"item_name":"X","quantity":1,"unit_price":1}]}')
check "POST /api/orders bad uuid" "$RES"

# PATCH non-existent customer
RES=$(curl -s -b "$ADM" -X PATCH "$B/api/customers/00000000-0000-0000-0000-000000000000" -H 'Content-Type: application/json' -d '{"full_name":"X"}')
check "PATCH unknown customer" "$RES"

# PATCH non-existent order
RES=$(curl -s -b "$ADM" -X PATCH "$B/api/orders/00000000-0000-0000-0000-000000000000" -H 'Content-Type: application/json' -d '{"items":[{"item_name":"X","quantity":1,"unit_price":1}]}')
check "PATCH unknown order" "$RES"

# Search with extreme query length
LONG=$(node -e "console.log('a'.repeat(5000))")
RES=$(curl -s -b "$ADM" "$B/api/customers/search?q=$LONG")
check "search very long q" "$RES"

exit $FAIL
