#!/usr/bin/env bash
# Regression: payment_method (Step 1).
set -u
B=${B:-http://localhost:3000}
ADM=${ADM:-/tmp/cookie_admin.txt}
STF=${STF:-/tmp/cookie_staff.txt}
P=0; F=0
ok()   { P=$((P+1)); echo "  PASS  $1"; }
fail() { F=$((F+1)); echo "  FAIL  $1"; }
jv()   { python3 -c "import sys,json; print(json.load(sys.stdin).get('$1',''))"; }

if [ ! -f "$ADM" ]; then curl -s -c "$ADM" -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"pin":"9851"}' >/dev/null; fi
if [ ! -f "$STF" ]; then curl -s -c "$STF" -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"pin":"1111"}' >/dev/null; fi

CID=$(curl -s -b "$ADM" "$B/api/customers/search?q=" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['customers'][0]['id'])")

echo "── Create order with each valid payment method ──"
for pm in cash card zelle; do
  RES=$(curl -s -b "$ADM" -X POST "$B/api/orders" -H 'Content-Type: application/json' \
    -d "{\"customer_id\":\"$CID\",\"items\":[{\"item_name\":\"X\",\"quantity\":1,\"unit_price\":1}],\"payment_method\":\"$pm\"}")
  OID=$(echo "$RES" | jv id); STORED=$(echo "$RES" | jv payment_method)
  [ "$STORED" = "$pm" ] && ok "POST order payment_method=$pm -> stored '$pm'" || fail "got '$STORED'"
  # Cleanup the order
  node --env-file=/Users/nicoluspathak/Downloads/meat-shop\ 2/.env.local -e "
const{createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{await sb.from('order_items').delete().eq('order_id','$OID');await sb.from('audit_log').delete().eq('entity_id','$OID');await sb.from('orders').delete().eq('id','$OID');await sb.rpc('increment_points',{customer_id_input:'$CID',points_to_add:-1});})();" 2>/dev/null
done

echo ""
echo "── Default to cash when payment_method missing ──"
RES=$(curl -s -b "$ADM" -X POST "$B/api/orders" -H 'Content-Type: application/json' \
  -d "{\"customer_id\":\"$CID\",\"items\":[{\"item_name\":\"X\",\"quantity\":1,\"unit_price\":1}]}")
OID=$(echo "$RES" | jv id); STORED=$(echo "$RES" | jv payment_method)
[ "$STORED" = "cash" ] && ok "missing payment_method defaults to 'cash'" || fail "got '$STORED'"

echo ""
echo "── Reject invalid payment_method ──"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$ADM" -X POST "$B/api/orders" -H 'Content-Type: application/json' \
  -d "{\"customer_id\":\"$CID\",\"items\":[{\"item_name\":\"X\",\"quantity\":1,\"unit_price\":1}],\"payment_method\":\"venmo\"}")
[ "$CODE" = "400" ] && ok "POST payment_method=venmo -> 400" || fail "got $CODE"
BODY=$(curl -s -b "$ADM" -X POST "$B/api/orders" -H 'Content-Type: application/json' \
  -d "{\"customer_id\":\"$CID\",\"items\":[{\"item_name\":\"X\",\"quantity\":1,\"unit_price\":1}],\"payment_method\":\"venmo\"}")
echo "$BODY" | grep -qE 'constraint|CHECK|orders_payment_method_check' && fail "response leaks DB constraint: $BODY" || ok "no DB constraint text leaked"

echo ""
echo "── Admin can change payment_method via PATCH ──"
RES=$(curl -s -b "$ADM" -X PATCH "$B/api/orders/$OID" -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"item_name\":\"X\",\"quantity\":1,\"unit_price\":1}],\"payment_method\":\"card\"}")
STORED=$(echo "$RES" | jv payment_method)
[ "$STORED" = "card" ] && ok "admin PATCH payment_method cash -> card" || fail "got '$STORED'"

echo ""
echo "── Audit row contains payment_method diff ──"
sleep 0.2
DIFF=$(node --env-file=/Users/nicoluspathak/Downloads/meat-shop\ 2/.env.local -e "
const{createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{const{data}=await sb.from('audit_log').select('changes').eq('entity_id','$OID').eq('action','updated').order('created_at',{ascending:false}).limit(1).maybeSingle();
console.log(JSON.stringify(data?.changes?.payment_method||null));})();
")
# Order-insensitive: check both keys are present with right values.
echo "$DIFF" | grep -q '"from":"cash"' && echo "$DIFF" | grep -q '"to":"card"' \
  && ok "audit changes.payment_method = {from:cash, to:card}" || fail "got $DIFF"

echo ""
echo "── Staff cannot change payment_method via PATCH ──"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$STF" -X PATCH "$B/api/orders/$OID" -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"item_name\":\"X\",\"quantity\":1,\"unit_price\":1}],\"payment_method\":\"zelle\"}")
[ "$CODE" = "403" ] && ok "staff PATCH payment_method -> 403" || fail "got $CODE"
# Verify the field did NOT change
STORED=$(curl -s -b "$ADM" "$B/api/customers/$CID" >/dev/null; node --env-file=/Users/nicoluspathak/Downloads/meat-shop\ 2/.env.local -e "
const{createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{const{data}=await sb.from('orders').select('payment_method').eq('id','$OID').maybeSingle();
console.log(data?.payment_method);})();")
[ "$STORED" = "card" ] && ok "payment_method unchanged after staff 403" || fail "got '$STORED'"

echo ""
echo "── orders.csv has payment_method column ──"
TODAY=$(node -e "console.log(new Date().toISOString().slice(0,10))")
PAST=$(node -e "const d=new Date();d.setDate(d.getDate()-2);console.log(d.toISOString().slice(0,10))")
curl -s -b "$ADM" "$B/api/export/orders.csv?from=$PAST&to=$TODAY" -o /tmp/orders_pm.csv
head -1 /tmp/orders_pm.csv | grep -q "payment_method" && ok "orders.csv header includes payment_method" || fail "no payment_method column"
head -1 /tmp/orders_pm.csv | grep -q "payment_status" && fail "phantom payment_status column still present" || ok "phantom payment_status column removed"
grep -E ",card," /tmp/orders_pm.csv >/dev/null && ok "orders.csv row contains the 'card' value we set" || fail "no 'card' row in CSV"

# Cleanup
node --env-file=/Users/nicoluspathak/Downloads/meat-shop\ 2/.env.local -e "
const{createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{await sb.from('order_items').delete().eq('order_id','$OID');await sb.from('audit_log').delete().eq('entity_id','$OID');await sb.from('orders').delete().eq('id','$OID');await sb.rpc('increment_points',{customer_id_input:'$CID',points_to_add:-1});})();" 2>/dev/null

echo ""
echo "Summary: $P passed, $F failed"
exit $F
