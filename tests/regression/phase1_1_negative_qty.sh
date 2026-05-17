#!/usr/bin/env bash
# Regression: Phase 1.1 — reject bad order item inputs.
# Before fix: 201 with subtotal -750 was accepted.
# After fix:  400 with a clean message; DB CHECK constraint backstops the API.
set -u
B=${B:-http://localhost:3000}
ADM=${ADM:-/tmp/cookie_admin.txt}

# Need a real customer to attach orders to. Reuse the most-recent one.
CID=$(curl -s -b "$ADM" "$B/api/customers/search?q=" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.customers?.[0]?.id||'')")
if [ -z "$CID" ]; then echo "FAIL setup: no customers in DB" >&2; exit 1; fi

probe() {
  local label="$1"; shift
  local payload="$1"; shift
  local expect="$1"
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$ADM" -X POST "$B/api/orders" -H 'Content-Type: application/json' -d "$payload")
  if [ "$CODE" = "$expect" ]; then echo "  PASS  $label -> $CODE"; else echo "  FAIL  $label expected $expect got $CODE"; FAIL=1; fi
}

FAIL=0
probe "negative quantity"  "{\"customer_id\":\"$CID\",\"items\":[{\"item_name\":\"X\",\"quantity\":-50,\"unit_price\":15}]}" "400"
probe "zero quantity"      "{\"customer_id\":\"$CID\",\"items\":[{\"item_name\":\"X\",\"quantity\":0,\"unit_price\":15}]}"  "400"
probe "quantity 1001"      "{\"customer_id\":\"$CID\",\"items\":[{\"item_name\":\"X\",\"quantity\":1001,\"unit_price\":1}]}" "400"
probe "negative price"     "{\"customer_id\":\"$CID\",\"items\":[{\"item_name\":\"X\",\"quantity\":1,\"unit_price\":-1}]}"   "400"
probe "empty items"        "{\"customer_id\":\"$CID\",\"items\":[]}" "400"
probe "missing customer"   "{\"items\":[{\"item_name\":\"X\",\"quantity\":1,\"unit_price\":1}]}" "400"
probe "valid baseline"     "{\"customer_id\":\"$CID\",\"items\":[{\"item_name\":\"OK\",\"quantity\":1,\"unit_price\":5}]}" "201"

# Cleanup the one valid baseline order
node --env-file=/Users/nicoluspathak/Downloads/meat-shop\ 2/.env.local -e "
const{createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{const {data:o}=await sb.from('orders').select('id').match({customer_id:'$CID',total:5,status:'active'});
  for(const r of o||[]){await sb.from('order_items').delete().eq('order_id',r.id);await sb.from('audit_log').delete().eq('entity_id',r.id);await sb.from('orders').delete().eq('id',r.id);}
  // Reverse the points: we earned floor(5)=5
  await sb.rpc('increment_points',{customer_id_input:'$CID',points_to_add:-5}).then(()=>{});
})();" 2>/dev/null
exit $FAIL
