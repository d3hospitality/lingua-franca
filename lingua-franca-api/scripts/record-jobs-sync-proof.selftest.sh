#!/usr/bin/env bash
# Self-test for record-jobs-sync-proof.sh. Drives every exit path offline by
# stubbing the wrapped assert (ASSERT=) and redirecting the durable sink
# (RECORD_FILE=) into a tmpdir — no network, no real CI run, no real file.
# Asserts: exit codes are forwarded verbatim, the durable file is written ONLY
# on a fresh exit-0 proof, idempotency suppresses a duplicate append, and an
# exit-0 with no extractable block does NOT write. Mutation-proof at the end.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUT="$SCRIPT_DIR/record-jobs-sync-proof.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }

# Build a stub assert that emits canned output and exits with a chosen code.
# $1 = exit code, $2 = path to output fixture.
make_stub() {
  local code="$1" fixture="$2" path="$TMP/assert-stub.sh"
  cat > "$path" <<EOF
#!/usr/bin/env bash
cat "$fixture"
exit $code
EOF
  chmod +x "$path"
  echo "$path"
}

# A realistic exit-0 fixture (run header + PROVEN block, as the real assert prints).
PROVEN_FIX="$TMP/proven.txt"
cat > "$PROVEN_FIX" <<'EOF'
== assert-schedule-jobs-sync-fired :: did 'audit-schedule-jobs-sync' report IN SYNC on a real cron tick? ==

  run     #99999999  (completed/success)
  created 2026-06-27T13:17:30Z
  url     https://github.com/d3hospitality/lingua-franca/actions/runs/99999999

  age     0h (within 26h freshness window)
  job     'audit-schedule-jobs-sync' concluded success on run #99999999

PROVEN (exit 0): 'audit-schedule-jobs-sync' ran UNATTENDED on schedule run #99999999 and its log reports
                 "IN SYNC (exit 0)" — the JOBS-default<->workflow drift guard passed on the
                 real cron tick, not just the merge-push. Wall-clock gap closed.
EOF

# A pending exit-2 fixture (no run/PROVEN block).
PENDING_FIX="$TMP/pending.txt"
cat > "$PENDING_FIX" <<'EOF'
== assert-schedule-jobs-sync-fired ==
  PENDING  added after the last tick — re-run after the next one.
NOT YET (exit 2)
EOF

# An exit-0-but-empty fixture (no extractable run line — defensive WARN path).
EMPTY_FIX="$TMP/empty.txt"
printf 'PROVEN but malformed output with no run header\n' > "$EMPTY_FIX"

run_sut() { # $1 stub, $2 record_file ; prints output, sets global RC
  ASSERT="$1" RECORD_FILE="$2" STAMP="2026-06-27T13:31:00Z" bash "$SUT" 2>&1
}

# ── Scenario 1: exit 2 forwarded, no file written ──
REC="$TMP/rec1.md"
OUT="$(run_sut "$(make_stub 2 "$PENDING_FIX")" "$REC")"; RC=$?
[ "$RC" -eq 2 ] && ok "exit 2 forwarded" || bad "exit 2 forwarded (got $RC)"
[ ! -f "$REC" ] && ok "exit 2 writes no record file" || bad "exit 2 wrote a record file"

# ── Scenario 2: exit 1 forwarded, no file written ──
REC="$TMP/rec2.md"
OUT="$(run_sut "$(make_stub 1 "$PENDING_FIX")" "$REC")"; RC=$?
[ "$RC" -eq 1 ] && ok "exit 1 forwarded" || bad "exit 1 forwarded (got $RC)"
[ ! -f "$REC" ] && ok "exit 1 writes no record file" || bad "exit 1 wrote a record file"

# ── Scenario 3: exit 0 fresh → record written with the PROVEN block ──
REC="$TMP/rec3.md"
STUB0="$(make_stub 0 "$PROVEN_FIX")"
OUT="$(run_sut "$STUB0" "$REC")"; RC=$?
[ "$RC" -eq 0 ] && ok "exit 0 forwarded" || bad "exit 0 forwarded (got $RC)"
[ -f "$REC" ] && ok "exit 0 writes the record file" || bad "exit 0 did NOT write the record file"
grep -q 'IN SYNC (exit 0)' "$REC" 2>/dev/null && ok "record holds the IN-SYNC marker" || bad "record missing IN-SYNC marker"
grep -q 'runs/99999999' "$REC" 2>/dev/null && ok "record holds the run URL key" || bad "record missing run URL"
echo "$OUT" | grep -q 'RECORDED' && ok "prints RECORDED on fresh capture" || bad "did not print RECORDED"

# ── Scenario 4: idempotent re-run → no duplicate append ──
LINES_BEFORE="$(wc -l < "$REC")"
OUT="$(run_sut "$STUB0" "$REC")"; RC=$?
LINES_AFTER="$(wc -l < "$REC")"
[ "$RC" -eq 0 ] && ok "idempotent re-run exits 0" || bad "idempotent re-run exit (got $RC)"
[ "$LINES_BEFORE" -eq "$LINES_AFTER" ] && ok "idempotent re-run appends nothing" || bad "idempotent re-run appended ($LINES_BEFORE -> $LINES_AFTER)"
echo "$OUT" | grep -q 'Already recorded' && ok "prints Already recorded on dup" || bad "did not detect duplicate"

# ── Scenario 5: exit 0 but no extractable block → WARN, no write ──
REC="$TMP/rec5.md"
OUT="$(run_sut "$(make_stub 0 "$EMPTY_FIX")" "$REC")"; RC=$?
[ "$RC" -eq 0 ] && ok "exit 0 (no block) still exits 0" || bad "exit 0 (no block) exit (got $RC)"
[ ! -f "$REC" ] && ok "exit 0 (no block) writes nothing" || bad "exit 0 (no block) wrote a file"
echo "$OUT" | grep -q 'WARN' && ok "prints WARN when no block found" || bad "did not WARN on missing block"

# ── Mutation proof: a stub that exits 0 MUST cause a write; if the SUT ignored
#    the exit code and never wrote, scenario 3's file-exists check would fail.
#    Verify the guard has teeth: an exit-2 fixture identical in body but code 2
#    must NOT write even though it could contain a block.
REC="$TMP/recM.md"
MUT_FIX="$TMP/mut.txt"; cp "$PROVEN_FIX" "$MUT_FIX"   # same body as the proof...
run_sut "$(make_stub 2 "$MUT_FIX")" "$REC" >/dev/null; RC=$?   # ...but exit 2
[ "$RC" -eq 2 ] && [ ! -f "$REC" ] && ok "mutation: proof body at exit 2 writes nothing (code gates the write)" \
  || bad "mutation: exit-2 with proof body leaked a write"

echo ""
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32mALL %d SCENARIOS PASS — every exit path of record-jobs-sync-proof.sh is locked.\033[0m\n' "$PASS"
  exit 0
else
  printf '\033[31m%d PASS / %d FAIL\033[0m\n' "$PASS" "$FAIL"
  exit 1
fi
