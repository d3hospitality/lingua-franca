#!/usr/bin/env bash
# Self-test for check-schedule-fired.sh — drives EVERY exit path of the cron
# verifier offline by stubbing `gh`, so the success (0) and regression (1)
# branches are proven WITHOUT waiting for the real 13:17 UTC schedule tick.
#
# Why this exists: until the cron actually fires on main, the only branch
# check-schedule-fired.sh has ever executed is the PENDING/exit-2 path. Its
# 175 lines of "run is green / run failed / job red / job missing / stale /
# still running" logic were untested. A stealth edit that, say, flipped a
# `!=` to `==` in the conclusion check would let a RED unattended run read as
# PASS and nobody would notice until an audit silently rotted. This harness
# locks all three exit codes against that drift.
#
# How it works: a fake `gh` is placed first on PATH. It answers `auth status`
# (exit 0) and serves canned JSON for `run list`/`run view` from env vars the
# test sets per scenario. jq is the real jq (the script's JSON parsing is part
# of what we're testing); jq is therefore required.
#
# Usage:   ./scripts/check-schedule-fired.selftest.sh
# Exit:    0 = all scenarios produced the expected exit code, 1 = a mismatch.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="$SCRIPT_DIR/check-schedule-fired.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0
FAIL=0

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

if ! command -v jq >/dev/null 2>&1; then
  printf '\033[33m%s\033[0m\n' "  SKIP  jq not found — this harness needs the real jq to test JSON parsing."
  exit 2
fi
if [ ! -f "$TARGET" ]; then
  red "  FAIL  cannot find target under test: $TARGET"; exit 1
fi

# ── fake gh on PATH ──────────────────────────────────────────────────────────
# It reads the scenario's canned output from files the harness writes per case:
#   $TMP/runlist.json  -> served for `gh run list ...`
#   $TMP/jobs.json     -> served for `gh run view ... --json jobs`
#   $TMP/runlist.rc    -> optional exit code for `run list` (default 0)
#   $TMP/wf_runsha.yml -> served for `gh api ...contents...?ref=$FAKE_RUNSHA`
#   $TMP/wf_main.yml   -> served for `gh api ...contents...?ref=<anything else>`
mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'GHEOF'
#!/usr/bin/env bash
# minimal gh stub: routes the subcommands check-schedule-fired.sh actually calls
case "$1 $2" in
  "auth status") exit 0 ;;
  "run list")
    cat "$FAKE_DIR/runlist.json" 2>/dev/null
    exit "$(cat "$FAKE_DIR/runlist.rc" 2>/dev/null || echo 0)"
    ;;
  "run view")
    cat "$FAKE_DIR/jobs.json" 2>/dev/null
    exit 0
    ;;
  "api "*)
    # job_defined_at fetches the workflow body at a git ref; serve the canned
    # body for the run's head SHA vs. any other ref (i.e. main). The ref rides in
    # the last argument (the contents path) as ?ref=<sha>.
    _last="${@: -1}"
    if [[ "$_last" == *"ref=$FAKE_RUNSHA"* ]]; then
      cat "$FAKE_DIR/wf_runsha.yml" 2>/dev/null
    else
      cat "$FAKE_DIR/wf_main.yml" 2>/dev/null
    fi
    exit 0
    ;;
  *) echo "stub gh: unhandled '$*'" >&2; exit 99 ;;
esac
GHEOF
chmod +x "$TMP/bin/gh"
export FAKE_DIR="$TMP"
export FAKE_RUNSHA="RUNSHA777"

# The six jobs branch-protection-audit.yml defines, and a helper that renders a
# minimal workflow body containing a chosen subset — used to simulate the
# workflow as it stood at the run's head SHA vs. on main now.
ALL6="audit-branch-protection audit-merge-gate selftest-schedule-verifier audit-proof-armed audit-required-checks-topology selftest-saga-aggregate"
wf_body() { # wf_body "<space-separated job ids>"
  printf 'name: branch-protection-audit\njobs:\n'
  for j in $1; do printf '  %s:\n    runs-on: ubuntu-latest\n' "$j"; done
}

# Run the target with the stubbed PATH and a chosen scenario, capture exit code.
# WF_RUNSHA_JOBS / WF_MAIN_JOBS (default: all five) control the workflow body the
# stub serves for the run's head SHA and for main respectively — this is how the
# added-after-run (benign) case is distinguished from skipped/removed (regression).
run_case() { # run_case "runlist.json contents" "jobs.json contents" [runlist.rc]
  printf '%s' "$1" > "$TMP/runlist.json"
  printf '%s' "$2" > "$TMP/jobs.json"
  printf '%s' "${3:-0}" > "$TMP/runlist.rc"
  wf_body "${WF_RUNSHA_JOBS:-$ALL6}" > "$TMP/wf_runsha.yml"
  wf_body "${WF_MAIN_JOBS:-$ALL6}" > "$TMP/wf_main.yml"
  PATH="$TMP/bin:$PATH" REPO=fake/repo "$TARGET" >/dev/null 2>&1
  echo $?
}

expect() { # expect "label" actual_exit expected_exit
  if [ "$2" = "$3" ]; then green "  PASS  $1 (exit $2)"; PASS=$((PASS+1));
  else red "  FAIL  $1 (got exit $2, want $3)"; FAIL=$((FAIL+1)); fi
}

# Fresh ISO-8601 timestamp (within the 26h window) and a stale one (>26h).
FRESH="$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
        || date -j -u -v-1H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"
STALE="$(date -u -d '-3 days' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
        || date -j -u -v-3d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"

run_obj() { # run_obj <status> <conclusion> <createdAt> [headSha]
  printf '[{"databaseId":777,"status":"%s","conclusion":"%s","createdAt":"%s","headBranch":"main","headSha":"%s","url":"https://x/777"}]' "$1" "$2" "$3" "${4:-RUNSHA777}"
}
jobs_obj() { # jobs_obj <bp> <mg> <st> <pa> <rt> <sa>  (empty string omits that job)
  # Mirrors the SIX jobs branch-protection-audit.yml defines, matching the
  # verifier's default JOBS list. The 3rd (selftest-schedule-verifier) is the
  # offline-logic guard CUSTODIAN added in PR #12; the 4th (audit-proof-armed) is
  # the pre-flight wiring guard OPS added; the 5th (audit-required-checks-topology)
  # is the self-extending topology audit PR #20 added; the 6th (selftest-saga-
  # aggregate) is the whole-apparatus roll-up OPS added — all must be enforced too.
  local arr="[]"
  [ -n "$1" ] && arr="$(printf '%s' "$arr" | jq --arg c "$1" '. + [{"name":"audit-branch-protection","conclusion":$c}]')"
  [ -n "$2" ] && arr="$(printf '%s' "$arr" | jq --arg c "$2" '. + [{"name":"audit-merge-gate","conclusion":$c}]')"
  [ -n "$3" ] && arr="$(printf '%s' "$arr" | jq --arg c "$3" '. + [{"name":"selftest-schedule-verifier","conclusion":$c}]')"
  [ -n "$4" ] && arr="$(printf '%s' "$arr" | jq --arg c "$4" '. + [{"name":"audit-proof-armed","conclusion":$c}]')"
  [ -n "$5" ] && arr="$(printf '%s' "$arr" | jq --arg c "$5" '. + [{"name":"audit-required-checks-topology","conclusion":$c}]')"
  [ -n "$6" ] && arr="$(printf '%s' "$arr" | jq --arg c "$6" '. + [{"name":"selftest-saga-aggregate","conclusion":$c}]')"
  printf '{"jobs":%s}' "$arr"
}

bold "== check-schedule-fired.selftest :: drive every exit path of the cron verifier =="
echo ""

# 1) Happy path: fresh schedule run, success, all SIX required jobs green -> exit 0.
EX="$(run_case "$(run_obj completed success "$FRESH")" "$(jobs_obj success success success success success success)")"
expect "fresh green schedule run, all six jobs green -> PASS"     "$EX" 0

# 2) The regression this guard EXISTS to catch: cron fired but run failed -> 1.
EX="$(run_case "$(run_obj completed failure "$FRESH")" "$(jobs_obj failure success success success success success)")"
expect "schedule run concluded 'failure' -> REGRESSION"          "$EX" 1

# 3) Overall green umbrella but a required job is red -> must still fail (1).
EX="$(run_case "$(run_obj completed success "$FRESH")" "$(jobs_obj failure success success success success success)")"
expect "overall success but audit-branch-protection red -> FAIL" "$EX" 1

# 4) A required job absent from the run while it DID exist at the run's head SHA
#    (default wf_runsha contains all six) -> skipped/not enforced -> fail (1).
EX="$(run_case "$(run_obj completed success "$FRESH")" "$(jobs_obj '' success success success success success)")"
expect "job absent from run but present at run SHA -> FAIL"       "$EX" 1

# 4b) The 3rd job (selftest-schedule-verifier) silently SKIPPED while overall is
#     still 'success' (skipped jobs don't flip a run to failure) -> must fail (1).
#     This is the exact gap the JOBS-list update closes: without the 3rd job in the
#     verifier's default list, this case would PASS blind. It is the proof of fix.
EX="$(run_case "$(run_obj completed success "$FRESH")" "$(jobs_obj success success '' success success success)")"
expect "selftest-schedule-verifier skipped, overall green -> FAIL" "$EX" 1

# 4c) The 4th job (audit-proof-armed) silently SKIPPED while overall is still
#     'success' -> must fail (1). Mirrors 4b for the new pre-flight wiring job: if
#     audit-proof-armed were dropped from the verifier's JOBS default, a run that
#     skipped it would pass blind. This case proves the 4-job coupling has teeth.
EX="$(run_case "$(run_obj completed success "$FRESH")" "$(jobs_obj success success success '' success success)")"
expect "audit-proof-armed skipped, overall green -> FAIL"        "$EX" 1

# 4d) The 5th job (audit-required-checks-topology) silently SKIPPED while overall
#     is still 'success' -> must fail (1). Mirrors 4b/4c for the topology audit PR
#     #20 added: if it were dropped from the verifier's JOBS default, a run that
#     skipped it would pass blind. This case proves the 5-job coupling has teeth.
EX="$(run_case "$(run_obj completed success "$FRESH")" "$(jobs_obj success success success success '' success)")"
expect "audit-required-checks-topology skipped, overall green -> FAIL" "$EX" 1

# 4d2) The 6th job (selftest-saga-aggregate) silently SKIPPED while overall is still
#     'success' -> must fail (1). Mirrors 4b/4c/4d for the whole-apparatus roll-up
#     OPS added: if it were dropped from the verifier's JOBS default, a run that
#     skipped it would pass blind. This case proves the 6-job coupling has teeth.
EX="$(run_case "$(run_obj completed success "$FRESH")" "$(jobs_obj success success success success success '')")"
expect "selftest-saga-aggregate skipped, overall green -> FAIL"  "$EX" 1

# 4e) The false-fail fix: a job ADDED to the workflow AFTER an older schedule run
#     fired — absent from the run AND absent at the run's head SHA, but present on
#     main now -> the job simply has not been through an unattended tick yet ->
#     PENDING (2), NOT a regression. Without the head-SHA timing check this case is
#     indistinguishable from 4d and would false-FAIL for the one tick between
#     landing a new audit job and its first scheduled run. This is THE fix.
EX="$(WF_RUNSHA_JOBS='audit-branch-protection audit-merge-gate selftest-schedule-verifier audit-proof-armed' \
      WF_MAIN_JOBS="$ALL6" \
      run_case "$(run_obj completed success "$FRESH")" "$(jobs_obj success success success success '' success)")"
expect "5th job added after run fired (on main, not at run SHA) -> PENDING" "$EX" 2

# 4f) Genuine removal everywhere — absent from the run, from the run's head SHA,
#     AND from main -> the JOBS list expects a job that exists nowhere -> FAIL (1).
#     This proves the not-at-run-SHA branch still surfaces real drift, so 4e's
#     benign exit-2 isn't a blanket "missing job is always fine" regression.
EX="$(WF_RUNSHA_JOBS='audit-branch-protection audit-merge-gate selftest-schedule-verifier audit-proof-armed' \
      WF_MAIN_JOBS='audit-branch-protection audit-merge-gate selftest-schedule-verifier audit-proof-armed' \
      run_case "$(run_obj completed success "$FRESH")" "$(jobs_obj success success success success '' success)")"
expect "5th job removed from run, run SHA, and main -> FAIL"      "$EX" 1

# 5) No schedule run yet (empty array) -> PENDING, inconclusive (2).
EX="$(run_case "[]" "$(jobs_obj success success success success success success)")"
expect "no schedule run yet -> PENDING (inconclusive)"           "$EX" 2

# 6) Stale: a green run, but older than the freshness window -> inconclusive (2).
EX="$(run_case "$(run_obj completed success "$STALE")" "$(jobs_obj success success success success success success)")"
expect "green run older than 26h -> STALE (inconclusive)"        "$EX" 2

# 7) Run still in progress (not completed) -> PENDING, inconclusive (2).
EX="$(run_case "$(run_obj in_progress '' "$FRESH")" "$(jobs_obj success success success success success success)")"
expect "run still in_progress -> PENDING (inconclusive)"         "$EX" 2

# 8) gh API error on `run list` (non-zero exit) -> inconclusive, never 1.
EX="$(run_case "" "$(jobs_obj success success success success success success)" 1)"
expect "gh run list errors -> inconclusive, not regression"      "$EX" 2

echo ""
if [ "$FAIL" -gt 0 ]; then
  red  "  $FAIL/$((PASS+FAIL)) scenarios MISMATCHED — check-schedule-fired.sh logic drifted."
  exit 1
fi
green "  ALL $PASS exit-path scenarios behave as specified."
exit 0
