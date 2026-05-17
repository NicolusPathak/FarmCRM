#!/usr/bin/env bash
# Regression: Phase 1.2 — duplicate phone returns 409 with a useful message.
set -u
B=${B:-http://localhost:3000}
ADM=${ADM:-/tmp/cookie_admin.txt}
PHONE="(555) 111-7777"
FAIL=0

mk() {
  curl -s -b "$ADM" -X POST "$B/api/customers" -H 'Content-Type: application/json' \
    -d "{\"full_name\":\"$1\",\"phone_number\":\"$PHONE\",\"street\":\"\",\"city\":\"\",\"zip_code\":\"\"}"
}

# First create should succeed
RES1=$(mk "Phone Owner")
CID=$(echo "$RES1" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).id||'')")
NUM=$(echo "$RES1" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).customer_number||'')")
[ -n "$CID" ] && echo "  PASS  first customer created ($NUM)" || { echo "  FAIL  first create: $RES1"; FAIL=1; }

# Second create with same phone must 409 and include the existing customer_number
RES2=$(curl -s -i -b "$ADM" -X POST "$B/api/customers" -H 'Content-Type: application/json' \
  -d "{\"full_name\":\"Phone Collider\",\"phone_number\":\"$PHONE\",\"street\":\"\",\"city\":\"\",\"zip_code\":\"\"}")
CODE=$(echo "$RES2" | head -1 | awk '{print $2}')
BODY=$(echo "$RES2" | tail -1)
[ "$CODE" = "409" ]                          && echo "  PASS  second create -> 409" || { echo "  FAIL  expected 409 got $CODE"; FAIL=1; }
echo "$BODY" | grep -q "$NUM"               && echo "  PASS  409 body includes existing customer_number ($NUM)" || { echo "  FAIL  body missing $NUM: $BODY"; FAIL=1; }
echo "$BODY" | grep -qE "(constraint|duplicate key|relation|psql)" && { echo "  FAIL  409 body leaks Postgres-ese: $BODY"; FAIL=1; } || echo "  PASS  no Postgres-ese leaks"

# Cleanup
node --env-file=/Users/nicoluspathak/Downloads/meat-shop\ 2/.env.local -e "
const{createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
sb.from('audit_log').delete().eq('entity_id','$CID').then(()=>sb.from('customers').delete().eq('id','$CID')).then(()=>{});" 2>/dev/null
exit $FAIL
