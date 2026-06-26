#!/usr/bin/env bash
# Aggregate runner for every cron-proof saga self-test — one command, one GREEN/RED verdict.
#
# WHY THIS EXISTS (the gap it closes):
#   The locked cron-proof mission is guarded by a fleet of offline self-tests — one per
#   apparatus script (close-mission, record, capture, schedule-verifier, durability-
#   contract, autorecord-live, preflight). Each proves its own gate logic without waiting
#   on the 13:30Z wall-clock tick. But there was NO single command that runs them all and
#   answers the only pre-tick question an operator actually has: "is the ENTIRE apparatus
#   still green right now, or did a refactor silently break one guard's self-test?"
#   Running seven scripts by hand and eyeballing seven exit codes is exactly where a
#   regression in one guard hides behind six greens.
#
#   This runner auto-discovers every scripts/*.selftest.sh, runs each in isolation,
#   captures its exit code, and emits a single roll-up verdict. Auto-discovery means any
#   future saga self-test is covered the moment it lands — no edit to this file required.
#
# Usage:
#   ./scripts/run-saga-selftests.sh            # run all, print per-test + roll-up
#   ./scripts/run-saga-selftests.sh --list     # list discovered self-tests, run nothing
#   ./scripts/run-saga-selftests.sh --quiet     # only print failures + the final verdict
#
# Exit codes:
#   0  ALL GREEN      — every discovered self-test passed. The apparatus is sound.
#   1  SOME RED        — at least one self-test failed; its name + exit code are printed.
#   2  NOTHING FOUND   — no *.selftest.sh discovered (wrong dir / glob broke). Never a
#                        silent green: zero tests is treated as a failure, not a pass.
#
# Test seam (used by run-saga-selftests.selftest.sh):
#   SELFTEST_DIR  — directory to glob for *.selftest.sh (default: this script's dir).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELFTEST_DIR="${SELFTEST_DIR:-$SCRIPT_DIR}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n'  "$1"; }
dim()   { printf '\033[2m%s\033[0m\n'  "$1"; }

MODE="run"
QUIET=0
case "${1:-}" in
  --list)  MODE="list" ;;
  --quiet) QUIET=1 ;;
  "")      ;;
  *) red "unknown arg: $1 (use --list or --quiet)"; exit 2 ;;
esac

# Discover self-tests deterministically (sorted) so output order is stable.
shopt -s nullglob
TESTS=()
for f in "$SELFTEST_DIR"/*.selftest.sh; do TESTS+=("$f"); done
shopt -u nullglob
IFS=$'\n' TESTS=($(printf '%s\n' "${TESTS[@]}" | sort)); unset IFS

if [ "${#TESTS[@]}" -eq 0 ]; then
  red "NOTHING FOUND (exit 2): no *.selftest.sh under $SELFTEST_DIR"
  red "  Wrong directory, or the discovery glob broke. Zero tests is NOT a pass."
  exit 2
fi

if [ "$MODE" = "list" ]; then
  bold "== saga self-tests discovered (${#TESTS[@]}) =="
  for t in "${TESTS[@]}"; do echo "  $(basename "$t")"; done
  exit 0
fi

bold "== run-saga-selftests :: every cron-proof guard's offline self-test, one verdict =="
[ "$QUIET" -eq 0 ] && dim "  ${#TESTS[@]} self-test(s) under $SELFTEST_DIR"

PASS=0
FAILED=()
for t in "${TESTS[@]}"; do
  name="$(basename "$t")"
  if out="$(bash "$t" 2>&1)"; then
    PASS=$((PASS + 1))
    [ "$QUIET" -eq 0 ] && green "  PASS  $name"
  else
    code=$?
    FAILED+=("$name (exit $code)")
    red "  FAIL  $name  (exit $code)"
    # Echo the failing self-test's last few lines so the cause is visible inline.
    printf '%s\n' "$out" | tail -6 | sed 's/^/        | /'
  fi
done

echo "────────────────────────────────────────────────────────────────"
if [ "${#FAILED[@]}" -eq 0 ]; then
  green "ALL GREEN (exit 0): ${PASS}/${#TESTS[@]} saga self-tests pass — the apparatus is sound."
  exit 0
fi
red "SOME RED (exit 1): ${#FAILED[@]}/${#TESTS[@]} saga self-test(s) FAILED:"
for f in "${FAILED[@]}"; do red "    - $f"; done
exit 1
