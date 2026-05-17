#!/usr/bin/env bash
# Regression: Phase 1.3 — POST /api/orders against an archived customer returns 400, not 500.
set -u
B=${B:-http://localhost:3000}
ADM=${ADM:-/tmp/cookie_admin.txt}
FAIL=0

# Create then archive a customer
RES=$(curl -s -b "$ADM" -X POST "$B/api/customers" -H 'Content-Type: application/json' \
  -d '{"full_name":"E2E Archive Target","phone_number":"","street":"","city":"","zip_code":""}')
CID=$(echo "$RES" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).id||'')")
curl -s -o /dev/null -b "$ADM" -X DELETE "$B/api/customers/$CID"

# Try to order against the archived customer
RES=$(curl -s -i -b "$ADM" -X POST "$B/api/orders" -H 'Content-Type: application/json' \
  -d "{\"customer_id\":\"$CID\",\"items\":[{\"item_name\":\"X\",\"quantity\":1,\"unit_price\":1}]}")
CODE=$(echo "$RES" | head -1 | awk '{print $2}')
BODY=$(echo "$RES" | tail -1)
[ "$CODE" = "400" ] && echo "  PASS  archived-customer order -> 400 (was 500)" || { echo "  FAIL  got $CODE: $BODY"; FAIL=1; }
echo "$BODY" | grep -qi "deleted" && echo "  PASS  body says 'deleted'" || { echo "  FAIL  body should mention deleted: $BODY"; FAIL=1; }
echo "$BODY" | grep -qE "(stack|constraint|relation|psql)" && { echo "  FAIL  body leaks internals"; FAIL=1; } || echo "  PASS  no internals leaked"

# Cleanup
node --env-file=/Users/nicoluspathak/Downloads/meat-shop\ 2/.env.local -e "
const{createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
sb.from('audit_log').delete().eq('entity_id','$CID').then(()=>sb.from('customers').delete().eq('id','$CID')).then(()=>{});" 2>/dev/null
exit $FAIL
