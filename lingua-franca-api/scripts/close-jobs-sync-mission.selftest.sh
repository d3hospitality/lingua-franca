#!/usr/bin/env bash
# Offline self-test for close-jobs-sync-mission.sh — drives the full (A,B) gate
# truth table AND the short-circuit ordering with NO network / gh, by overriding
# the two gates through the ARMED_BIN / FIRED_BIN env seams with controllable stubs.
#
# What it proves:
#   1. Every (armed, fired) exit-code pair maps to the documented closeout exit.
#   2. Short-circuit ordering: a non-zero ARMED gate ABORTS before FIRED ever runs
#      (a PENDING/REGRESSION fired result must never be reached, let alone trusted,
#      when the apparatus is not armed).
#   3. Teeth: a mutation (treat NOT-ARMED exit 1 as "continue") is CAUGHT.
#
# Exit 0 = all scenarios pass; 1 = a scenario failed (the orchestrator has drifted).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORCH="$SCRIPT_DIR/close-jobs-sync-mission.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0; fail=0
green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }

# Build a stub gate that records that it ran (into $WORK/<name>.ran) and exits $rc.
make_stub() {
  local path="$1" name="$2" rc="$3"
  cat > "$path" <<EOF
#!/usr/bin/env bash
echo "[stub:$name] ran (rc=$rc)"
: > "$WORK/$name.ran"
exit $rc
EOF
  chmod +x "$path"
}

# Run the orchestrator (or a mutated copy) with stubbed gates.
# Args: armed_rc fired_rc  → echoes "<exit> <armed_ran> <fired_ran>"
run_case() {
  local armed_rc="$1" fired_rc="$2" orch="${3:-$ORCH}"
  rm -f "$WORK/armed.ran" "$WORK/fired.ran"
  make_stub "$WORK/armed.sh" armed "$armed_rc"
  make_stub "$WORK/fired.sh" fired "$fired_rc"
  ARMED_BIN="$WORK/armed.sh" FIRED_BIN="$WORK/fired.sh" bash "$orch" >/dev/null 2>&1
  local ec=$?
  local ar="no" fr="no"
  [ -f "$WORK/armed.ran" ] && ar="yes"
  [ -f "$WORK/fired.ran" ] && fr="yes"
  echo "$ec $ar $fr"
}

check() {
  local desc="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then green "  PASS  $desc"; pass=$((pass+1))
  else red "  FAIL  $desc"; red "        got:  $got"; red "        want: $want"; fail=$((fail+1)); fi
}

printf '\033[1m%s\033[0m\n' "== close-jobs-sync-mission self-test =="
echo ""

# ── Truth table: "<exit> <armed_ran> <fired_ran>" ─────────────────────────────
# A=1 NOT ARMED → BLOCKED exit 1, fired NEVER runs (short-circuit).
check "A=NOT ARMED(1)      → BLOCKED, fired skipped"  "$(run_case 1 0)" "1 yes no"
# A=2 INCONCLUSIVE → NOT YET exit 2, fired NEVER runs (short-circuit).
check "A=INCONCLUSIVE(2)   → NOT YET, fired skipped"  "$(run_case 2 0)" "2 yes no"
# A=0 ARMED → fired decides:
check "A=ARMED(0) B=PROVEN(0)  → MISSION CLOSED"      "$(run_case 0 0)" "0 yes yes"
check "A=ARMED(0) B=PENDING(2) → NOT YET"             "$(run_case 0 2)" "2 yes yes"
check "A=ARMED(0) B=REGRESS(1) → BLOCKED"             "$(run_case 0 1)" "1 yes yes"

# Defence-in-depth: even if ARMED is broken, a downstream FIRED failure must not
# flip the verdict green — A=1 with B=0 still BLOCKS (fired not even consulted).
check "A=NOT ARMED(1) B=PROVEN(0) → still BLOCKED"    "$(run_case 1 0)" "1 yes no"

echo ""
# ── Mutation: prove the short-circuit on NOT-ARMED has teeth ───────────────────
# Flip gate A's "case 1) ... exit 1" abort into a continue (delete the exit 1 line's
# guard) — a mutant that wrongly proceeds to FIRED when NOT ARMED. The truth-table
# case "A=NOT ARMED(1) → fired skipped" must now FAIL on the mutant.
MUT="$WORK/mutant.sh"
# Remove the gate-A exit-1 abort line so control falls through to gate B.
sed '/BLOCKED (exit 1): apparatus not armed/d' "$ORCH" > "$MUT"
mut_out="$(run_case 1 0 "$MUT")"
if [ "$mut_out" != "1 yes no" ]; then
  green "  PASS  mutant (NOT-ARMED no longer aborts) is CAUGHT — got: $mut_out"
  pass=$((pass+1))
else
  red   "  FAIL  mutant slipped through — short-circuit abort has no teeth"
  fail=$((fail+1))
fi

echo ""
printf '\033[2m%s\033[0m\n' "────────────────────────────────────────────────────────────────"
if [ "$fail" -eq 0 ]; then
  green "ALL $pass SCENARIOS PASS — every exit path & the short-circuit of close-jobs-sync-mission.sh is locked."
  exit 0
else
  red "$fail FAILED, $pass passed — close-jobs-sync-mission.sh has drifted."
  exit 1
fi
