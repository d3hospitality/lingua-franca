#!/usr/bin/env bash
# Offline self-test for check-schedule-jobs-sync.sh — proves the IN-SYNC / DRIFT /
# INCONCLUSIVE verdicts WITHOUT a network or gh, by feeding the guard fabricated
# workflow + verifier files via its AUDIT_YML / VERIFIER test seams.
#
# Drives every exit path:
#   0  identical sets (order-independent)
#   1  workflow has a job the verifier default lacks (added-a-job, missed-a-touch)
#   1  verifier default has a job the workflow dropped (stale entry)
#   2  a source file is missing
#   2  a side parses to zero jobs
# Mutation check: a fixture that SHOULD drift but is fed an in-sync verifier must
# NOT pass — proves the guard actually compares the two sets, not just one side.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$SCRIPT_DIR/check-schedule-jobs-sync.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }

# Write a fake audit workflow whose `jobs:` block has the given job ids.
make_wf() {
  local path="$1"; shift
  { printf 'name: audit\non:\n  schedule:\n    - cron: "17 13 * * *"\njobs:\n'
    for j in "$@"; do printf '  %s:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n' "$j"; done
  } > "$path"
}

# Write a fake check-schedule-fired.sh carrying the given JOBS default.
make_verifier() {
  local path="$1"; shift
  printf '#!/usr/bin/env bash\nJOBS_RAW="${JOBS:-%s}"\n' "$*" > "$path"
}

run() {  # run <label> <expected_exit> <audit_yml> <verifier>
  local label="$1" want="$2" wf="$3" vf="$4"
  AUDIT_YML="$wf" VERIFIER="$vf" "$GUARD" >/dev/null 2>&1
  local got=$?
  [ "$got" -eq "$want" ] && ok "$label (exit $got)" || bad "$label (want $want, got $got)"
}

THREE="audit-branch-protection audit-merge-gate selftest-saga-aggregate"

# ── exit 0: identical sets, deliberately different ORDER on each side ───────────
make_wf       "$TMP/a0.yml" audit-branch-protection audit-merge-gate selftest-saga-aggregate
make_verifier "$TMP/v0.sh"  selftest-saga-aggregate audit-branch-protection audit-merge-gate
run "identical sets, different order -> IN SYNC" 0 "$TMP/a0.yml" "$TMP/v0.sh"

# verifier default may use comma separators too
make_verifier "$TMP/v0c.sh" "audit-merge-gate,selftest-saga-aggregate,audit-branch-protection"
run "comma-separated default -> IN SYNC" 0 "$TMP/a0.yml" "$TMP/v0c.sh"

# ── exit 1: workflow gained a job the verifier default never learned ───────────
make_wf       "$TMP/a1.yml" audit-branch-protection audit-merge-gate selftest-saga-aggregate audit-new-job
make_verifier "$TMP/v1.sh"  $THREE
run "workflow has extra job -> DRIFT" 1 "$TMP/a1.yml" "$TMP/v1.sh"

# ── exit 1: verifier default holds a job the workflow dropped ───────────────────
make_wf       "$TMP/a2.yml" audit-branch-protection audit-merge-gate
make_verifier "$TMP/v2.sh"  $THREE
run "verifier has stale job -> DRIFT" 1 "$TMP/a2.yml" "$TMP/v2.sh"

# ── exit 2: a source file is missing ───────────────────────────────────────────
run "missing workflow file -> INCONCLUSIVE" 2 "$TMP/nope.yml" "$TMP/v0.sh"
run "missing verifier file -> INCONCLUSIVE" 2 "$TMP/a0.yml" "$TMP/nope.sh"

# ── exit 2: a side parses to zero jobs ─────────────────────────────────────────
printf 'name: x\non: push\njobs:\n' > "$TMP/empty.yml"
run "workflow with no jobs -> INCONCLUSIVE" 2 "$TMP/empty.yml" "$TMP/v0.sh"
make_verifier "$TMP/vempty.sh" ""
run "verifier with empty default -> INCONCLUSIVE" 2 "$TMP/a0.yml" "$TMP/vempty.sh"

# ── mutation teeth: a known-drift workflow fed an IN-SYNC verifier must NOT exit 1
make_verifier "$TMP/v1ok.sh" audit-branch-protection audit-merge-gate selftest-saga-aggregate audit-new-job
AUDIT_YML="$TMP/a1.yml" VERIFIER="$TMP/v1ok.sh" "$GUARD" >/dev/null 2>&1
[ $? -eq 0 ] && ok "mutation: matching the verifier to the drifted workflow flips to IN SYNC" \
             || bad "mutation: guard ignored the verifier side (drift not driven by comparison)"

echo "────────────────────────────────────────────"
if [ "$fail" -eq 0 ]; then
  printf '\033[32mALL GREEN: %d/%d checks pass.\033[0m\n' "$pass" "$pass"; exit 0
else
  printf '\033[31m%d FAILED, %d passed.\033[0m\n' "$fail" "$pass"; exit 1
fi
