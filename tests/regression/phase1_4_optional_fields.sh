#!/usr/bin/env bash
# Regression: Phase 1.4 — POST /api/customers with only full_name no longer 500s.
set -u
B=${B:-http://localhost:3000}
ADM=${ADM:-/tmp/cookie_admin.txt}
FAIL=0

RES=$(curl -s -i -b "$ADM" -X POST "$B/api/customers" -H 'Content-Type: application/json' -d '{"full_name":"Bare Bones Customer"}')
CODE=$(echo "$RES" | head -1 | awk '{print $2}')
BODY=$(echo "$RES" | tail -1)
[ "$CODE" = "201" ] && echo "  PASS  POST with only full_name -> 201 (was 500)" || { echo "  FAIL  got $CODE: $BODY"; FAIL=1; }

# Check the response body still contains a customer
CID=$(echo "$BODY" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).id||'')")
[ -n "$CID" ] && echo "  PASS  response includes new customer id" || { echo "  FAIL  no id: $BODY"; FAIL=1; }

# Also test PATCH with partial body
if [ -n "$CID" ]; then
  RES=$(curl -s -i -b "$ADM" -X PATCH "$B/api/customers/$CID" -H 'Content-Type: application/json' -d '{"full_name":"Bare Bones Renamed","phone_number":""}')
  CODE=$(echo "$RES" | head -1 | awk '{print $2}')
  [ "$CODE" = "200" ] && echo "  PASS  PATCH with partial body -> 200" || { echo "  FAIL  got $CODE: $(echo "$RES"|tail -1)"; FAIL=1; }
fi

# Cleanup
[ -n "$CID" ] && node --env-file=/Users/nicoluspathak/Downloads/meat-shop\ 2/.env.local -e "
const{createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
sb.from('audit_log').delete().eq('entity_id','$CID').then(()=>sb.from('customers').delete().eq('id','$CID')).then(()=>{});" 2>/dev/null

exit $FAIL
