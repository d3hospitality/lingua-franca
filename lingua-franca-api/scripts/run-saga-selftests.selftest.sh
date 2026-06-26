#!/usr/bin/env bash
# Offline self-test for run-saga-selftests.sh — proves the aggregate runner's roll-up
# verdict is correct WITHOUT running the real (slow, gh-dependent) saga self-tests.
#
# HOW:
#   We point the runner's SELFTEST_DIR seam at a throwaway sandbox containing stub
#   *.selftest.sh scripts whose exit codes we control. Then we assert the runner's
#   roll-up: all-pass → exit 0, any-fail → exit 1, empty dir → exit 2, plus --list.
#   A mutation guard flips the runner's pass/fail mapping and proves the harness fails.
set -uo pipefail

RUNNER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run-saga-selftests.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n'  "$1"; }

# make_dir <name> <exitcode...> → a sandbox dir with one stub *.selftest.sh per exit code.
make_dir() {
  local d="$TMP/$1"; shift
  mkdir -p "$d"
  local i=0
  for code in "$@"; do
    printf '#!/usr/bin/env bash\necho "stub %s"\nexit %s\n' "$i" "$code" > "$d/stub$i.selftest.sh"
    chmod +x "$d/stub$i.selftest.sh"
    i=$((i + 1))
  done
  echo "$d"
}

PASS=0
# assert <label> <expected-exit> <dir> [extra-arg]
assert() {
  local label="$1" want="$2" dir="$3" arg="${4:-}"
  SELFTEST_DIR="$dir" bash "$RUNNER" $arg >/dev/null 2>&1
  local got=$?
  if [ "$got" -eq "$want" ]; then
    PASS=$((PASS + 1)); green "  PASS  $label  (exit $got)"
  else
    red "  FAIL  $label  (want $want, got $got)"; exit 1
  fi
}

bold "== run-saga-selftests.selftest :: aggregate roll-up verdict (offline) =="

ALL_GREEN="$(make_dir all_green 0 0 0)"
ONE_RED="$(make_dir one_red 0 1 0)"
ALL_RED="$(make_dir all_red 1 2 3)"
EMPTY="$(make_dir empty)"   # no exit codes → no stubs

bold "[1] every stub passes → ALL GREEN (exit 0)"
assert "3 passing stubs → 0" 0 "$ALL_GREEN"

bold "[2] one stub fails → SOME RED (exit 1)"
assert "2 pass + 1 fail → 1" 1 "$ONE_RED"
assert "all 3 fail → 1"      1 "$ALL_RED"

bold "[3] empty dir → NOTHING FOUND (exit 2, never a silent green)"
assert "no self-tests → 2" 2 "$EMPTY"

bold "[4] --list runs nothing and exits 0 even when a stub would fail"
assert "--list over a failing dir → 0" 0 "$ONE_RED" "--list"

bold "[5] mutation guard — invert the runner's pass/fail mapping, harness MUST catch it"
MUT="$TMP/mutant.sh"
# Flip the success branch: treat a passing self-test as a failure. A correct harness
# must now report the all-green dir as exit 1.
sed 's/if out="\$(bash "\$t" 2>&1)"; then/if ! out="$(bash "$t" 2>\&1)"; then/' "$RUNNER" > "$MUT"
chmod +x "$MUT"
SELFTEST_DIR="$ALL_GREEN" bash "$MUT" >/dev/null 2>&1
mut_code=$?
if [ "$mut_code" -ne 0 ]; then
  PASS=$((PASS + 1)); green "  PASS  mutated runner (pass→fail) correctly NON-zero ($mut_code) — harness has teeth"
else
  red "  FAIL  mutated runner still exited 0 — harness would not catch a broken roll-up"; exit 1
fi

echo "────────────────────────────────────────────────────────────────"
green "  ALL $PASS checks PASS — aggregate roll-up verdict is correct."
