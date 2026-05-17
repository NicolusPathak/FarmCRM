#!/usr/bin/env bash
# Regression: Phase 2.2 — audit_log rows carry ip + user_agent in changes._meta.
# (Schema-level columns weren't an option, so we store the trace inside the
# existing changes jsonb under a reserved _meta key.)
set -u
B=${B:-http://localhost:3000}
ADM=${ADM:-/tmp/cookie_admin.txt}
UA="Phase2Regression/$(date +%s)"
FAIL=0

# Create + archive a probe customer with a distinctive User-Agent.
RES=$(curl -s -b "$ADM" -A "$UA" -X POST "$B/api/customers" -H 'Content-Type: application/json' \
  -d '{"full_name":"Phase 2 Probe","phone_number":"","street":"","city":"","zip_code":""}')
CID=$(echo "$RES" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).id||'')")
[ -n "$CID" ] || { echo "  FAIL  could not create probe customer"; exit 1; }
curl -s -o /dev/null -b "$ADM" -A "$UA" -X DELETE "$B/api/customers/$CID"

# Inspect audit rows for this entity.
RESULT=$(node --env-file=/Users/nicoluspathak/Downloads/meat-shop\ 2/.env.local -e "
const{createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{
  const {data} = await sb.from('audit_log').select('action, changes').eq('entity_id','$CID').order('created_at');
  let pass = 0, fail = 0;
  for (const r of data || []) {
    const meta = r.changes?._meta;
    if (meta && meta.user_agent && meta.user_agent.startsWith('$UA')) {
      console.log('  PASS  audit:', r.action, 'has _meta.user_agent + ip=', meta.ip || '(none)'); pass++;
    } else {
      console.log('  FAIL  audit:', r.action, '_meta missing or wrong:', JSON.stringify(meta)); fail++;
    }
  }
  if (pass === 0) console.log('  FAIL  no audit rows found at all');
  // cleanup
  await sb.from('audit_log').delete().eq('entity_id','$CID');
  await sb.from('customers').delete().eq('id','$CID');
  process.exit(fail > 0 || pass === 0 ? 1 : 0);
})();
")
RC=$?
echo "$RESULT"
exit $RC
