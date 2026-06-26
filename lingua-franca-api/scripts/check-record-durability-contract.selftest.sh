#!/usr/bin/env bash
# Self-test for check-record-durability-contract.sh — proves the guard has TEETH.
#
# Strategy: copy the three REAL source scripts into a sandbox, point the guard at
# the copies via *_SRC env vars, and assert:
#   1. unmutated copies            → exit 0 (INTACT)
#   2. drift the producer header   → exit 1 (extractor sed & gate C grep no longer match)
#   3. drift the extractor sed     → exit 1 (record would extract nothing)
#   4. drift gate C's grep         → exit 1 (durability check would falsely block)
#   5. remove the producer line    → exit 2 (INCONCLUSIVE — can't locate the literal)
# If a mutation is NOT caught, the guard is a stale rubber-stamp and the test fails.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$SCRIPT_DIR/check-record-durability-contract.sh"

pass=0; fail=0
green(){ printf '\033[32m  PASS  %s\033[0m\n' "$1"; pass=$((pass+1)); }
red()  { printf '\033[31m  FAIL  %s\033[0m\n' "$1"; fail=$((fail+1)); }

# run_guard <capture> <record> <closeout> → echoes the guard's exit code
run_guard() {
  CAPTURE_SRC="$1" RECORD_SRC="$2" CLOSEOUT_SRC="$3" \
    bash "$GUARD" >/dev/null 2>&1
  echo $?
}

assert() { # <label> <expected-exit> <capture> <record> <closeout>
  local got; got="$(run_guard "$3" "$4" "$5")"
  if [ "$got" -eq "$2" ]; then green "$1  (exit $got)"; else red "$1  (got $got, want $2)"; fi
}

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
C="$work/capture-cron-proof.sh"
R="$work/record-cron-proof.sh"
O="$work/close-cron-proof-mission.sh"
cp "$SCRIPT_DIR/capture-cron-proof.sh"        "$C"
cp "$SCRIPT_DIR/record-cron-proof.sh"         "$R"
cp "$SCRIPT_DIR/close-cron-proof-mission.sh"  "$O"

printf '\033[1m[1] unmutated copies → INTACT\033[0m\n'
assert "pristine sources agree" 0 "$C" "$R" "$O"

printf '\033[1m[2] drift the PRODUCER header → DRIFT caught\033[0m\n'
Cmut="$work/capture.mut"; cp "$C" "$Cmut"
# Rename the printed header so neither the sed nor the grep pattern matches it.
sed -i.bak 's/UNATTENDED \$N_EXPECTED-JOB EXIT-0 PROOF CAPTURED:/UNATTENDED $N_EXPECTED-JOB EXIT-ZERO PROOF LOGGED:/' "$Cmut"
assert "renamed producer header is caught" 1 "$Cmut" "$R" "$O"

printf '\033[1m[3] drift the EXTRACTOR sed pattern → DRIFT caught\033[0m\n'
Rmut="$work/record.mut"; cp "$R" "$Rmut"
sed -i.bak "s#UNATTENDED .\*-JOB EXIT-0 PROOF CAPTURED:#UNATTENDED .*-JOB EXIT-0 PROOF SEALED:#" "$Rmut"
assert "drifted record sed is caught" 1 "$C" "$Rmut" "$O"

printf '\033[1m[4] drift gate C grep pattern → DRIFT caught\033[0m\n'
Omut="$work/closeout.mut"; cp "$O" "$Omut"
sed -i.bak "s#UNATTENDED .\*-JOB EXIT-0 PROOF CAPTURED#UNATTENDED .*-JOB EXIT-0 PROOF FILED#" "$Omut"
assert "drifted gate C grep is caught" 1 "$C" "$R" "$Omut"

printf '\033[1m[5] remove the producer header line → DRIFT caught\033[0m\n'
# A removed producer header genuinely breaks the win path (record extracts nothing),
# so the correct verdict is DRIFT (1), not a soft INCONCLUSIVE.
Cgone="$work/capture.gone"; cp "$C" "$Cgone"
sed -i.bak '/UNATTENDED \$N_EXPECTED-JOB EXIT-0 PROOF CAPTURED:/d' "$Cgone"
assert "missing producer line → exit 1 (win path broken)" 1 "$Cgone" "$R" "$O"

printf '\033[1m[6] remove the extractor anchor line → INCONCLUSIVE\033[0m\n'
# When the guard cannot even locate record's sed anchor, it cannot reason about the
# contract — that is the genuine INCONCLUSIVE (2) path, distinct from real drift.
Rgone="$work/record.gone"; cp "$R" "$Rgone"
sed -i.bak "/sed -n '\/UNATTENDED/d" "$Rgone"
assert "missing extractor anchor → exit 2" 2 "$C" "$Rgone" "$O"

printf '\033[2m────────────────────────────────────────────────────────────────\033[0m\n'
if [ "$fail" -eq 0 ]; then
  printf '\033[32m  ALL %d checks PASS — the durability-header contract guard has teeth.\033[0m\n' "$pass"
  exit 0
fi
printf '\033[31m  %d/%d FAILED — guard is not catching drift.\033[0m\n' "$fail" "$((pass+fail))"
exit 1
