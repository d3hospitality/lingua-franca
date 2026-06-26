#!/usr/bin/env bash
# Offline self-test for close-cron-proof-mission.sh — proves the one-shot closeout
# orchestrator maps every {Gate A, Gate B, Gate C} exit-code combination to the
# correct overall verdict, AND short-circuits in the right order, WITHOUT waiting
# for the real 13:17/13:30 UTC cron tick or touching the network.
#
# WHY THIS EXISTS (the gap it closes):
#   close-cron-proof-mission.sh is the LOAD-BEARING one-shot the locked cron-proof
#   mission hinges on — a human (or relay agent) lands at the tick after a ~24h wait
#   and runs it exactly once. Every other script in this saga has a self-test;
#   this orchestrator did not. If its gate→exit mapping silently drifts (e.g. a
#   capture exit-2 PENDING mis-read as exit-0 CLOSED, or Gate A failing to abort
#   before trusting Gate C), the one-shot mis-fires and either declares a false
#   victory or buries the real win. This locks the decision logic offline.
#
# HOW IT WORKS:
#   The orchestrator resolves its sub-scripts via SCRIPT_DIR=dirname(BASH_SOURCE).
#   We copy the REAL orchestrator into a tmpdir and drop three controllable STUB
#   sub-scripts beside it. Each stub exits with a code we pick per-case and appends
#   its letter to an ORDER log, so we assert BOTH the final exit code AND that
#   later gates never ran once an earlier gate aborted.
#
# Exit: 0 = all cases pass.  1 = a case failed (orchestrator logic regressed).

set -uo pipefail

ORCH_REAL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/close-cron-proof-mission.sh"
[ -f "$ORCH_REAL" ] || { echo "FATAL: orchestrator not found at $ORCH_REAL"; exit 1; }

PASS=0; FAIL=0
green() { printf '\033[32m  PASS  %s\033[0m\n' "$1"; PASS=$((PASS+1)); }
red()   { printf '\033[31m  FAIL  %s\033[0m\n' "$1"; FAIL=$((FAIL+1)); }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

# Build an isolated sandbox: a copy of the orchestrator + three stub sub-scripts.
# $1 = orchestrator source path to copy (lets us inject a mutated copy too).
make_sandbox() {
  local src="$1" work
  work="$(mktemp -d)"
  cp "$src" "$work/close-cron-proof-mission.sh"
  chmod +x "$work/close-cron-proof-mission.sh"
  # Stubs: append a letter to $STUB_ORDER, then exit with the per-gate env code.
  cat > "$work/assert-cron-proof-armed.sh"      <<'EOF'
#!/usr/bin/env bash
printf 'A' >> "$STUB_ORDER"; exit "${STUB_A:-0}"
EOF
  cat > "$work/check-proof-verdict-contract.sh" <<'EOF'
#!/usr/bin/env bash
printf 'B' >> "$STUB_ORDER"; exit "${STUB_B:-0}"
EOF
  cat > "$work/record-cron-proof.sh"            <<'EOF'
#!/usr/bin/env bash
printf 'C' >> "$STUB_ORDER"; exit "${STUB_C:-0}"
EOF
  chmod +x "$work"/*.sh
  printf '%s' "$work"
}

# run_case A B C → echoes "<exit> <order>" from a fresh sandbox of the REAL orch.
run_case() {
  local work; work="$(make_sandbox "$ORCH_REAL")"
  local order="$work/order.log"; : > "$order"
  STUB_A="$1" STUB_B="$2" STUB_C="$3" STUB_ORDER="$order" \
    "$work/close-cron-proof-mission.sh" >/dev/null 2>&1
  local ec=$?
  printf '%s %s' "$ec" "$(cat "$order")"
  rm -rf "$work"
}

# assert label  A B C  → expected_exit expected_order
assert() {
  local label="$1" got want_exit want_order
  got="$(run_case "$2" "$3" "$4")"
  want_exit="$5"; want_order="$6"
  local ge="${got%% *}" go="${got##* }"
  if [ "$ge" = "$want_exit" ] && [ "$go" = "$want_order" ]; then
    green "$label  (A=$2 B=$3 C=$4 → exit $ge, ran [$go])"
  else
    red "$label  (A=$2 B=$3 C=$4 → exit $ge ran [$go]; WANT exit $want_exit ran [$want_order])"
  fi
}

bold "== close-cron-proof-mission.selftest :: gate→verdict truth table (offline) =="
echo ""

bold "[1] Gate A aborts — apparatus NOT ARMED / inconclusive (B & C must NOT run)"
assert "A=1 NOT ARMED      → BLOCKED, stop at A" 1 0 0  1 "A"
assert "A=2 inconclusive   → NOT YET, stop at A" 2 0 0  2 "A"
echo ""

bold "[2] Gate B aborts — contract drift after A passed (C must NOT run)"
assert "A=0 B=1 drift       → BLOCKED, stop at B" 0 1 0  1 "AB"
assert "A=0 B=2 drift(!=0)  → BLOCKED, stop at B" 0 2 0  1 "AB"
echo ""

bold "[3] Gate C decides — A & B both clean, all three gates run"
assert "C=0 WIN PATH        → MISSION CLOSED" 0 0 0  0 "ABC"   # tomorrow's tick
assert "C=2 PENDING         → NOT YET"        0 0 2  2 "ABC"   # today's live state
assert "C=1 regression      → BLOCKED"        0 0 1  1 "ABC"
assert "C=3 odd nonzero     → BLOCKED (default arm)" 0 0 3  1 "ABC"
echo ""

bold "[4] Gate A 'already captured' passthrough — A=0 continues to B/C"
# (A's case{} only special-cases 1 & 2; any other A code falls through to ARMED)
assert "A=3 odd → treated as armed, reaches C=0 WIN" 3 0 0  0 "ABC"
echo ""

# ── Mutation guard: prove the harness has TEETH ───────────────────────────────
# Flip the orchestrator's win mapping (capture exit 0 ⇒ exit 0) to a buggy
# exit 2, then re-run the WIN PATH. A real test MUST now fail to catch it.
bold "[5] mutation guard — a broken win-path mapping MUST be caught"
MUT="$(make_sandbox "$ORCH_REAL")"
# Replace the success-arm 'exit 0' inside the case "$C" block with 'exit 2'.
# Target the unique line: the green MISSION CLOSED arm ends in 'exit 0 ;;'.
if perl -0pi -e 's/(MISSION CLOSED.*?)exit 0 ;;/${1}exit 2 ;;/s' "$MUT/close-cron-proof-mission.sh"; then
  morder="$MUT/order.log"; : > "$morder"
  STUB_A=0 STUB_B=0 STUB_C=0 STUB_ORDER="$morder" \
    "$MUT/close-cron-proof-mission.sh" >/dev/null 2>&1
  mec=$?
  if [ "$mec" -ne 0 ]; then
    green "mutated win-path (exit0→exit2) is correctly NON-zero ($mec) — harness has teeth"
  else
    red "mutated win-path still returned 0 — harness would NOT catch a broken closeout!"
  fi
else
  red "could not apply mutation (perl substitution failed) — cannot prove teeth"
fi
rm -rf "$MUT"
echo ""

bold "────────────────────────────────────────────────────────────────"
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32m  ALL %d checks PASS — closeout gate logic is correct; the one-shot will fire true at the tick.\033[0m\n' "$PASS"
  exit 0
else
  printf '\033[31m  %d/%d checks FAILED — closeout orchestrator logic regressed.\033[0m\n' "$FAIL" "$((PASS+FAIL))"
  exit 1
fi
