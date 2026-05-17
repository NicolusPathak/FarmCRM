#!/usr/bin/env bash
# Run every Phase 1 regression test in this folder.
# Returns nonzero if any test fails.
set -u
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
B=${B:-http://localhost:3000}
ADM=${ADM:-/tmp/cookie_admin.txt}

# Ensure admin cookie exists
if [ ! -f "$ADM" ]; then
  echo "Capturing admin cookie at $ADM (PIN 9851)..."
  curl -s -c "$ADM" -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"pin":"9851"}' > /dev/null
fi

OVERALL=0
for f in "$HERE"/phase1_*.sh; do
  name=$(basename "$f")
  echo ""
  echo "═══ $name ═══"
  bash "$f"
  rc=$?
  if [ $rc -ne 0 ]; then OVERALL=1; fi
done

echo ""
if [ $OVERALL -eq 0 ]; then echo "All Phase 1 regression tests PASSED."; else echo "Some Phase 1 regression tests FAILED."; fi
exit $OVERALL
