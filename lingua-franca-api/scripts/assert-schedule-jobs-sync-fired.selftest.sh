#!/usr/bin/env bash
# Self-test for assert-schedule-jobs-sync-fired.sh — drives EVERY exit path of the
# mission-closer offline by stubbing `gh`, so its PROVEN (0) and REGRESSION (1)
# branches are locked WITHOUT waiting for the real 13:17 UTC schedule tick.
#
# Why this exists: until the cron fires on main with the job present, the only
# branch the verifier ever executes live is PENDING/exit-2. Its log-marker proof
# — the whole point of the script (green job + IN-SYNC line == PROVEN; green job +
# missing line == REGRESSION) — would otherwise ship untested, and a stealth edit
# that, say, dropped the `grep -F` marker check (letting any green job read as
# PROVEN) would go unnoticed. This harness asserts the marker logic has teeth.
#
# How it works: a fake `gh` first on PATH answers `auth status`, serves canned
# `run list` / `run view --json jobs` JSON, canned `run view --job ... --log`
# text, and canned workflow bodies for `api ...contents...?ref=`. Real jq parses
# the JSON (that parsing is part of what's under test).
#
# Usage:   ./scripts/assert-schedule-jobs-sync-fired.selftest.sh
# Exit:    0 = all scenarios produced the expected exit code, 1 = a mismatch.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="$SCRIPT_DIR/assert-schedule-jobs-sync-fired.sh"
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

export FAKE_RUNSHA="RUNSHA777"
JOB="audit-schedule-jobs-sync"
MARKER="IN SYNC (exit 0)"

# ── fake gh on PATH ──────────────────────────────────────────────────────────
# Files the harness writes per case:
#   $FAKE_DIR/runlist.json   -> served for `gh run list`        ($FAKE_DIR/runlist.rc = its exit code)
#   $FAKE_DIR/jobs.json      -> served for `gh run view <id> --json jobs`
#   $FAKE_DIR/joblog.txt     -> served for `gh run view --job <id> --log`  (rc from joblog.rc)
#   $FAKE_DIR/wf_runsha.yml  -> served for `gh api ...contents...?ref=$FAKE_RUNSHA`
#   $FAKE_DIR/wf_main.yml    -> served for `gh api ...contents...?ref=<anything else>`
mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'GHEOF'
#!/usr/bin/env bash
case "$1 $2" in
  "auth status") exit 0 ;;
  "run list")
    cat "$FAKE_DIR/runlist.json" 2>/dev/null
    exit "$(cat "$FAKE_DIR/runlist.rc" 2>/dev/null || echo 0)"
    ;;
  "run view")
    # Two forms: `run view <id> --json jobs`  vs  `run view --job <id> --log`.
    if printf '%s ' "$@" | grep -q -- '--log'; then
      cat "$FAKE_DIR/joblog.txt" 2>/dev/null
      exit "$(cat "$FAKE_DIR/joblog.rc" 2>/dev/null || echo 0)"
    fi
    cat "$FAKE_DIR/jobs.json" 2>/dev/null
    exit 0
    ;;
  "api "*)
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

ALL7="audit-branch-protection audit-merge-gate selftest-schedule-verifier audit-proof-armed audit-required-checks-topology selftest-saga-aggregate audit-schedule-jobs-sync"
wf_body() { printf 'name: branch-protection-audit\njobs:\n'; for j in $1; do printf '  %s:\n    runs-on: ubuntu-latest\n' "$j"; done; }

FRESH="$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -j -u -v-1H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"
STALE="$(date -u -d '-3 days' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -j -u -v-3d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"

run_obj() { # run_obj <status> <conclusion> <createdAt> [headSha]
  printf '[{"databaseId":777,"status":"%s","conclusion":"%s","createdAt":"%s","headBranch":"main","headSha":"%s","url":"https://x/777"}]' "$1" "$2" "$3" "${4:-RUNSHA777}"
}
# jobs_obj <jobConclusion> [databaseId] — single relevant job; empty conclusion omits it.
jobs_obj() {
  if [ -z "$1" ]; then printf '{"jobs":[{"name":"audit-branch-protection","conclusion":"success","databaseId":11}]}'; return; fi
  printf '{"jobs":[{"name":"audit-branch-protection","conclusion":"success","databaseId":11},{"name":"%s","conclusion":"%s","databaseId":%s}]}' "$JOB" "$1" "${2:-99}"
}

# run_case "runlist" "jobs" "joblog" [runlist.rc] [joblog.rc] — returns exit code.
run_case() {
  printf '%s' "$1" > "$TMP/runlist.json"
  printf '%s' "$2" > "$TMP/jobs.json"
  printf '%s' "$3" > "$TMP/joblog.txt"
  printf '%s' "${4:-0}" > "$TMP/runlist.rc"
  printf '%s' "${5:-0}" > "$TMP/joblog.rc"
  wf_body "${WF_RUNSHA_JOBS:-$ALL7}" > "$TMP/wf_runsha.yml"
  wf_body "${WF_MAIN_JOBS:-$ALL7}"   > "$TMP/wf_main.yml"
  PATH="$TMP/bin:$PATH" REPO=fake/repo "$TARGET" >/dev/null 2>&1
  echo $?
}

expect() { # expect "label" actual expected
  if [ "$2" = "$3" ]; then green "  PASS  $1 (exit $2)"; PASS=$((PASS+1));
  else red "  FAIL  $1 (got exit $2, want $3)"; FAIL=$((FAIL+1)); fi
}

bold "== assert-schedule-jobs-sync-fired.selftest :: drive every exit path =="
echo ""

# 1. no schedule run yet (pre-tick) → PENDING
expect "no schedule run yet"            "$(run_case '[]' "$(jobs_obj success 99)" "x $MARKER y")" 2

# 2. run still in progress → PENDING
expect "run still in_progress"          "$(run_case "$(run_obj in_progress '' "$FRESH")" "$(jobs_obj success 99)" "x $MARKER y")" 2

# 3. stale run (>26h) → PENDING/STALE
expect "stale schedule run"             "$(run_case "$(run_obj completed success "$STALE")" "$(jobs_obj success 99)" "x $MARKER y")" 2

# 4. fresh + green job + log HAS the marker → PROVEN (the mission-close path)
expect "green job + IN-SYNC marker"     "$(run_case "$(run_obj completed success "$FRESH")" "$(jobs_obj success 99)" "2026 $MARKER : matches")" 0

# 5. fresh + green job but log MISSING the marker → REGRESSION (the stealth catch)
expect "green job, marker MISSING"      "$(run_case "$(run_obj completed success "$FRESH")" "$(jobs_obj success 99)" "all good, exit 0 somehow")" 1

# 6. job red on the schedule run → REGRESSION
expect "job concluded failure"          "$(run_case "$(run_obj completed success "$FRESH")" "$(jobs_obj failure 99)" "$MARKER")" 1

# 7. overall run failed → REGRESSION (job also red here)
expect "overall run failure"            "$(run_case "$(run_obj completed failure "$FRESH")" "$(jobs_obj failure 99)" "whatever")" 1

# 8. job absent but added-after (present on main, not at run SHA) → PENDING
expect "job added after run fired"      "$(WF_RUNSHA_JOBS='audit-branch-protection' WF_MAIN_JOBS="$ALL7" run_case "$(run_obj completed success "$FRESH")" "$(jobs_obj '')" "x")" 2

# 9. job absent but defined at run SHA (skipped/dropped) → REGRESSION
expect "job skipped/dropped at run SHA" "$(WF_RUNSHA_JOBS="$ALL7" WF_MAIN_JOBS="$ALL7" run_case "$(run_obj completed success "$FRESH")" "$(jobs_obj '')" "x")" 1

# 10. job green but log fetch fails (rc!=0) → INCONCLUSIVE (never a silent pass)
expect "job green, log unreadable"      "$(run_case "$(run_obj completed success "$FRESH")" "$(jobs_obj success 99)" "" 0 7)" 2

# 11. gh run list itself errors → INCONCLUSIVE
expect "run list gh error"              "$(run_case '' "$(jobs_obj success 99)" "x" 4)" 2

echo ""
bold "----------------------------------------------------------------"
if [ "$FAIL" -eq 0 ]; then
  green "ALL $PASS SCENARIOS PASS — every exit path of assert-schedule-jobs-sync-fired.sh is locked."
  exit 0
fi
red "$FAIL FAILED / $PASS passed — the verifier's exit logic has drifted."
exit 1
