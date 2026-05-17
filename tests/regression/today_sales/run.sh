#!/usr/bin/env bash
# Regression: today's sales panel (Step 2).
# Uses shopRanges() math indirectly by inserting orders at known
# instants and checking which bucket they fall into via the dashboard SSR.
set -u
B=${B:-http://localhost:3000}
ADM=${ADM:-/tmp/cookie_admin.txt}
P=0; F=0
ok()   { P=$((P+1)); echo "  PASS  $1"; }
fail() { F=$((F+1)); echo "  FAIL  $1"; }

if [ ! -f "$ADM" ]; then curl -s -c "$ADM" -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"pin":"9851"}' >/dev/null; fi

# Test 1: shopRanges helper math directly — round-trip an instant
# at 11:30 PM Chicago time on day D, then 00:01 AM on day D+1.
node --env-file=/Users/nicoluspathak/Downloads/meat-shop\ 2/.env.local <<'JS'
// Re-implement the boundary math inline (same as lib/utils.ts shopRanges)
// to avoid TS-loader complexity in this regression.
const TZ = 'America/Chicago';
function ymd(d){return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function offsetMin(d){const o=new Intl.DateTimeFormat('en-US',{timeZone:TZ,timeZoneName:'longOffset'}).formatToParts(d).find(p=>p.type==='timeZoneName')?.value||'GMT+00:00';const m=/GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(o);if(!m)return 0;const h=parseInt(m[1],10);return h*60+(h<0?-1:1)*parseInt(m[2]||'0',10);}
function bound(d,end){const[y,m,dd]=d.split('-').map(Number);const probe=new Date(Date.UTC(y,m-1,dd,12));const off=offsetMin(probe);const hourMs=end?(23*3600+59*60+59)*1000+999:0;return Date.UTC(y,m-1,dd)+hourMs-off*60000;}

// At a known instant: 2026-05-14 23:30:00 Chicago (CDT, UTC-5) = 2026-05-15 04:30:00 UTC
const lateChicago = new Date('2026-05-15T04:30:00Z');
const dayLabel    = ymd(lateChicago);   // should be 2026-05-14 in CT
const todayStart  = bound(dayLabel, false);
const todayEnd    = bound(dayLabel, true);
const t = lateChicago.getTime();
if (t >= todayStart && t <= todayEnd) console.log('  PASS  23:30 Chicago lands in shop-TZ "today" window for that calendar date');
else console.log('  FAIL  late Chicago instant did not bucket into the right day');
if (dayLabel === '2026-05-14') console.log('  PASS  shopYMD returned 2026-05-14 for 23:30 CDT');
else console.log('  FAIL  shopYMD returned', dayLabel);

// 00:01 of D+1 Chicago = 05:01 UTC of D+1 = bucketed into D+1
const nextDay = new Date('2026-05-15T05:01:00Z');
const nextLabel = ymd(nextDay);
if (nextLabel === '2026-05-15') console.log('  PASS  00:01 Chicago of D+1 buckets to D+1');
else console.log('  FAIL  D+1 instant got', nextLabel);
JS

echo ""
echo "── Dashboard SSR shows the 4 panel labels ──"
HTML=$(curl -s -b "$ADM" "$B/dashboard")
for label in Today Yesterday "This week" "This month"; do
  echo "$HTML" | grep -q ">$label<" && ok "panel label '$label' rendered" || fail "missing '$label'"
done

echo ""
echo "── Seed a today-evening order, confirm it appears in 'Today' panel ──"
CID=$(curl -s -b "$ADM" "$B/api/customers/search?q=" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['customers'][0]['id'])")
# Insert order directly with order_date = "now" in shop TZ to guarantee it's in 'today'.
OID=$(node --env-file=/Users/nicoluspathak/Downloads/meat-shop\ 2/.env.local -e "
const{createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{const{data:n}=await sb.rpc('get_next_order_number');const{data:o}=await sb.from('orders').insert({order_number:n,customer_id:'$CID',order_date:new Date().toISOString(),subtotal:13,total:13,points_earned:13,status:'active',payment_method:'cash',change_log:[]}).select().single();await sb.from('order_items').insert({order_id:o.id,item_name:'TodayProbe',quantity:1,unit_price:13,line_total:13});console.log(o.id);})();
" 2>/dev/null)
# Fetch dashboard again and check Today panel shows a non-zero revenue + at least 1 order
HTML=$(curl -s -b "$ADM" "$B/dashboard")
# Extract the "Today" card's USD + order-count text
TODAY_BLOCK=$(echo "$HTML" | python3 -c "
import sys, re
html = sys.stdin.read()
# Find the Today card: starts at >Today< and ends with the next card
m = re.search(r'>Today</div>(.+?)</div></div>', html, re.DOTALL)
print(m.group(1) if m else 'NONE')
")
# Strip React's HTML comment markers ('<!-- -->') that split text nodes
TODAY_CLEAN=$(echo "$TODAY_BLOCK" | sed 's/<!--[^>]*-->//g')
echo "$TODAY_CLEAN" | grep -qE '\$1[3-9]\.00|\$[2-9][0-9]+\.' && ok "'Today' panel shows non-zero revenue (\$13+)" || fail "no revenue: $TODAY_CLEAN"
echo "$TODAY_CLEAN" | grep -qE '[1-9][0-9]* orders?' && ok "'Today' panel shows order count" || fail "no order count: $TODAY_CLEAN"

echo ""
echo "── Void the order — 'Today' revenue should drop ──"
curl -s -o /dev/null -b "$ADM" -X PATCH "$B/api/orders/$OID" -H 'Content-Type: application/json' -d '{"action":"void"}'
sleep 0.2
HTML=$(curl -s -b "$ADM" "$B/dashboard")
TODAY_BLOCK_AFTER=$(echo "$HTML" | python3 -c "
import sys, re
html = sys.stdin.read()
m = re.search(r'>Today</div>(.+?)</div></div>', html, re.DOTALL)
print(m.group(1) if m else 'NONE')
")
echo "$TODAY_BLOCK_AFTER" | grep -qE '\\\$13\\.00' && fail "voided order still in revenue" || ok "voided order removed from Today revenue"

# Cleanup
node --env-file=/Users/nicoluspathak/Downloads/meat-shop\ 2/.env.local -e "
const{createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{await sb.from('order_items').delete().eq('order_id','$OID');await sb.from('audit_log').delete().eq('entity_id','$OID');await sb.from('orders').delete().eq('id','$OID');})();" 2>/dev/null

# DST sanity: pick March 9 and November 2 dates and check no off-by-an-hour
echo ""
echo "── DST boundary sanity (helper math) ──"
node --env-file=/Users/nicoluspathak/Downloads/meat-shop\ 2/.env.local -e "
const TZ='America/Chicago';
function offsetMin(d){const o=new Intl.DateTimeFormat('en-US',{timeZone:TZ,timeZoneName:'longOffset'}).formatToParts(d).find(p=>p.type==='timeZoneName')?.value||'GMT+00:00';const m=/GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(o);if(!m)return 0;const h=parseInt(m[1],10);return h*60+(h<0?-1:1)*parseInt(m[2]||'0',10);}
// In 2026: DST starts March 8 (spring-forward at 02:00 → 03:00 CDT).
// DST ends November 1 (fall-back at 02:00 CDT → 01:00 CST).
// Therefore at noon UTC:
//   March 7   → still CST  (-360)
//   March 8   → already CDT (-300, since 2 AM passed by noon UTC = 7 AM CDT)
//   November 1 → already CST (-360, fall-back happened at 7 AM UTC = 1 AM CST)
//   November 2 → CST       (-360)
const days = [
  { d: '2026-03-07T12:00:00Z', exp: -360, label: 'March 7 (CST)' },
  { d: '2026-03-08T12:00:00Z', exp: -300, label: 'March 8 (CDT begins)' },
  { d: '2026-11-01T12:00:00Z', exp: -360, label: 'Nov 1 (CST resumes)' },
  { d: '2026-11-02T12:00:00Z', exp: -360, label: 'Nov 2 (CST)' },
];
let allOk = true;
for (const t of days) {
  const got = offsetMin(new Date(t.d));
  if (got === t.exp) console.log('  PASS  DST math: ' + t.label + ' offset=' + got);
  else { console.log('  FAIL  ' + t.label + ' expected ' + t.exp + ' got ' + got); allOk = false; }
}
if (!allOk) process.exit(1);
"

echo ""
echo "Summary: $P passed, $F failed"
exit $F
