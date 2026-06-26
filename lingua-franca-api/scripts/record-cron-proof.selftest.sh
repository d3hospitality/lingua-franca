#!/usr/bin/env bash
# Offline self-test for record-cron-proof.sh. Stubs capture-cron-proof.sh to
# drive each exit code (0/1/2) with NO network, and asserts the durable sink:
#   - exit 2/1  → forwarded verbatim, RECORD_FILE NOT written
#   - exit 0    → forwarded, record block appended to RECORD_FILE
#   - re-run on exit 0 → idempotent, no duplicate block
#   - exit 0 with no block in output → exit 0 but RECORD_FILE NOT written
# Mutation guard: if the wrapper wrote the file on exit 2, the test catches it.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER="$SCRIPT_DIR/record-cron-proof.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0 FAIL=0
ok()   { printf '\033[32m  PASS\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '\033[31m  FAIL\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }

# A fake capture-cron-proof.sh whose exit code + output we control via env.
STUB="$TMP/capture.sh"
cat > "$STUB" <<'STUBEOF'
#!/usr/bin/env bash
printf '%s\n' "${STUB_OUT:-}"
exit "${STUB_CODE:-2}"
STUBEOF
chmod +x "$STUB"

WIN_BLOCK='PROVEN — genuine UNATTENDED 5-job exit-0 cron proof captured.

  UNATTENDED 5-JOB EXIT-0 PROOF CAPTURED:
    proof workflow run : #99999 (event=schedule, main) 2026-06-27T13:30Z
    judged audit run   : #88888
    coverage           : all 5 expected jobs green: a b c d e'

run() {  # CODE OUT RECORD_FILE  →  echoes "exit_code"
  CAPTURE="$STUB" RECORD_FILE="$3" STAMP="2026-06-27T13:31:00Z" \
    STUB_CODE="$1" STUB_OUT="$2" bash "$WRAPPER" >/dev/null 2>&1
  echo "$?"
}

# 1. exit 2 (pending) — forwarded, no file
F="$TMP/r2.md"; C="$(run 2 'NOT YET (exit 2)' "$F")"
[ "$C" = 2 ] && ok "exit 2 forwarded" || bad "exit 2 forwarded (got $C)"
[ ! -f "$F" ] && ok "exit 2 writes no record file" || bad "exit 2 WROTE a record file (mutation!)"

# 2. exit 1 (regression) — forwarded, no file
F="$TMP/r1.md"; C="$(run 1 'MIS-PROVEN' "$F")"
[ "$C" = 1 ] && ok "exit 1 forwarded" || bad "exit 1 forwarded (got $C)"
[ ! -f "$F" ] && ok "exit 1 writes no record file" || bad "exit 1 WROTE a record file (mutation!)"

# 3. exit 0 (win) — forwarded, block appended
F="$TMP/r0.md"; C="$(run 0 "$WIN_BLOCK" "$F")"
[ "$C" = 0 ] && ok "exit 0 forwarded" || bad "exit 0 forwarded (got $C)"
if [ -f "$F" ] && grep -qF 'UNATTENDED 5-JOB EXIT-0 PROOF CAPTURED:' "$F"; then
  ok "exit 0 appends the record block"
else
  bad "exit 0 did NOT append the record block"
fi

# 4. re-run on the SAME proof — idempotent, no duplicate
run 0 "$WIN_BLOCK" "$F" >/dev/null
N="$(grep -cF 'UNATTENDED 5-JOB EXIT-0 PROOF CAPTURED:' "$F")"
[ "$N" -eq 1 ] && ok "re-run is idempotent (1 block, not $N)" || bad "re-run DUPLICATED the block ($N copies)"

# 5. exit 0 but NO block in output — exit 0, file untouched
F="$TMP/r0nob.md"; C="$(run 0 'unexpected success with no block' "$F")"
[ "$C" = 0 ] && [ ! -f "$F" ] && ok "exit 0 w/o block: exits 0, writes nothing" \
  || bad "exit 0 w/o block mishandled (code=$C, file exists: $([ -f "$F" ] && echo yes || echo no))"

echo ""
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32mALL %d CHECKS PASS — record sink writes only on a genuine exit-0, idempotently.\033[0m\n' "$PASS"
  exit 0
fi
printf '\033[31m%d/%d FAILED\033[0m\n' "$FAIL" "$((PASS+FAIL))"
exit 1
