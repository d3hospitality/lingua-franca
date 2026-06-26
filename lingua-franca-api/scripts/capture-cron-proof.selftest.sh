#!/usr/bin/env bash
# Self-test for capture-cron-proof.sh — drives EVERY exit path of the unattended
# N-job cron-proof capturer offline by stubbing `gh`, so the genuine exit-0
# (5-job PASS) and the MIS-PROVEN exit-1 branches are PROVEN WITHOUT waiting for
# the real 13:17/13:30 UTC schedule tick.
#
# Why this exists: until the cron fires a tick whose judged audit run covers all
# expected jobs, capture-cron-proof.sh has only ever executed its PARTIAL/exit-2
# path (the latest real proof judged a 4-of-5-job run — see the live run output).
# Its record-emitting exit-0 block and its non-green MIS-PROVEN exit-1 block were
# NEVER exercised. A stealth edit that, say, flipped the `!= success` job check
# or weakened the `PASS ... UNATTENDED` verdict grep would let a stale/partial
# tick read as a captured proof and the locked mission would be closed on a lie.
# This harness locks all three exit codes against that drift, offline.
#
# How it works: a fake `gh` is placed first on PATH. It answers `auth status`
# (exit 0) and serves canned JSON/log text for `run list` / `run view --log` /
# `run view --json jobs` from files the harness writes per scenario. jq is the
# real jq (the script's JSON parsing is part of what we're testing). The expected
# job set is parsed from the REAL branch-protection-audit.yml on disk exactly as
# the script parses it, so the fixtures auto-track if a 6th audit job is ever
# added — the test never hard-codes the job count.
#
# Usage:   ./scripts/capture-cron-proof.selftest.sh
# Exit:    0 = all scenarios produced the expected exit code, 1 = a mismatch,
#          2 = prerequisite missing (jq, target, or workflow file).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="$SCRIPT_DIR/capture-cron-proof.sh"
LF_API_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$LF_API_DIR")"
AUDIT_YML="$REPO_ROOT/.github/workflows/branch-protection-audit.yml"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0
FAIL=0

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

if ! command -v jq >/dev/null 2>&1; then
  yellow "  SKIP  jq not found — this harness needs the real jq to test JSON parsing."; exit 2
fi
if [ ! -f "$TARGET" ]; then
  red "  FAIL  cannot find target under test: $TARGET"; exit 1
fi
if [ ! -f "$AUDIT_YML" ]; then
  yellow "  SKIP  cannot find $AUDIT_YML — run from a lingua-franca clone checked out on main."; exit 2
fi

# Expected audit job ids parsed from the REAL workflow exactly as the script does
# (top-level keys under `jobs:`, 2-space indent). Fixtures are built over THIS set,
# so the test stays correct as jobs are added/removed.
EXPECTED_JOBS="$(awk '
  /^jobs:/        {injobs=1; next}
  injobs && /^[^[:space:]]/ {injobs=0}
  injobs && /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ {gsub(/[: ]/,""); print}
' "$AUDIT_YML")"
N_EXPECTED="$(printf '%s\n' $EXPECTED_JOBS | grep -c .)"
if [ "$N_EXPECTED" -lt 1 ]; then
  yellow "  SKIP  could not parse any job ids from $AUDIT_YML."; exit 2
fi

# ── fake gh on PATH ──────────────────────────────────────────────────────────
# Routes only the subcommands capture-cron-proof.sh actually calls:
#   gh auth status                 -> exit 0
#   gh run list ...                -> serves $TMP/runlist.json (rc from runlist.rc)
#   gh run view <id> --log         -> serves $TMP/log.txt
#   gh run view <id> --json jobs   -> serves $TMP/jobs.json
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
    for a in "$@"; do
      if [ "$a" = "--log" ]; then cat "$FAKE_DIR/log.txt" 2>/dev/null; exit 0; fi
    done
    cat "$FAKE_DIR/jobs.json" 2>/dev/null
    exit 0
    ;;
  *) echo "stub gh: unhandled '$*'" >&2; exit 99 ;;
esac
GHEOF
chmod +x "$TMP/bin/gh"
export FAKE_DIR="$TMP"

# ── fixture builders ─────────────────────────────────────────────────────────
proof_run() { # proof_run <status> <conclusion>   (empty array handled by caller)
  printf '[{"databaseId":777,"headSha":"DEADBEEF","status":"%s","conclusion":"%s","createdAt":"2026-06-27T13:30:00Z"}]' "$1" "$2"
}

# A PASS log: the exit-0 verdict line + an extractable "run #888" + a created line.
LOG_PASS="$(printf '%s\n' \
  'PASS  schedule-fired-proof.yml fired UNATTENDED on its cron — every required job is green' \
  'judged audit run #888 created 2026-06-27T13:17:02Z')"
# A NEUTRAL/PENDING log: the exit-2 line the script greps for first.
LOG_PENDING='PENDING  the cron fired green, but a job was added after the newest schedule run #888'
# A PASS log that carries no extractable audit run id -> exit 2 at id extraction.
LOG_PASS_NOID='PASS  fired UNATTENDED on its cron — every required job is green (no id here)'
# Output that is neither PENDING nor PASS -> inconclusive exit 2.
LOG_GARBAGE='some unexpected output for run #888 with no verdict line'

build_jobs() { # build_jobs <all|miss|fail>  — over the REAL expected job set
  local mode="$1" arr="[]" idx=0 concl
  for j in $EXPECTED_JOBS; do
    concl=success
    if [ "$idx" -eq 0 ]; then
      if [ "$mode" = miss ]; then idx=1; continue; fi
      if [ "$mode" = fail ]; then concl=failure; fi
    fi
    idx=1
    arr="$(printf '%s' "$arr" | jq --arg n "$j" --arg c "$concl" '. + [{"name":$n,"conclusion":$c}]')"
  done
  printf '{"jobs":%s}' "$arr"
}
JOBS_ALL="$(build_jobs all)"
JOBS_MISS="$(build_jobs miss)"
JOBS_FAIL="$(build_jobs fail)"

run_case() { # run_case <runlist.json> <log text> <jobs.json> [runlist.rc]
  printf '%s' "$1" > "$TMP/runlist.json"
  printf '%s' "$2" > "$TMP/log.txt"
  printf '%s' "$3" > "$TMP/jobs.json"
  printf '%s' "${4:-0}" > "$TMP/runlist.rc"
  PATH="$TMP/bin:$PATH" REPO=fake/repo "$TARGET" >/dev/null 2>&1
  echo $?
}

expect() { # expect "label" actual expected
  if [ "$2" = "$3" ]; then green "  PASS  $1 (exit $2)"; PASS=$((PASS+1));
  else red "  FAIL  $1 (got exit $2, want $3)"; FAIL=$((FAIL+1)); fi
}

bold "== capture-cron-proof.selftest :: drive every exit path of the N-job proof capturer =="
echo  "  (expecting $N_EXPECTED audit job(s) per the live workflow: $(printf '%s ' $EXPECTED_JOBS))"
echo ""

# 1) THE never-before-exercised happy path: completed/success proof run, PASS
#    UNATTENDED verdict, judged audit run covers ALL expected jobs green -> exit 0.
EX="$(run_case "$(proof_run completed success)" "$LOG_PASS" "$JOBS_ALL")"
expect "genuine N-job PASS, all jobs green -> CAPTURED (exit 0)"        "$EX" 0

# 2) The unattended REGRESSION this capturer exists to surface: proof run itself
#    concluded failure (verifier hit exit 1 at the tick) -> exit 1.
EX="$(run_case "$(proof_run completed failure)" "$LOG_PASS" "$JOBS_ALL")"
expect "proof run concluded failure -> REGRESSION (exit 1)"            "$EX" 1

# 3) PASS verdict but a required job in the judged audit run is non-green ->
#    MIS-PROVEN regression -> exit 1. (The other never-tested branch: line 162.)
EX="$(run_case "$(proof_run completed success)" "$LOG_PASS" "$JOBS_FAIL")"
expect "PASS but a required job red in judged run -> MIS-PROVEN (exit 1)" "$EX" 1

# 4) PASS verdict but the judged audit run is missing an expected job (older-SHA,
#    fewer-than-N coverage) -> PARTIAL, not yet proven -> exit 2.
EX="$(run_case "$(proof_run completed success)" "$LOG_PASS" "$JOBS_MISS")"
expect "PASS but judged run covers fewer than N jobs -> PARTIAL (exit 2)" "$EX" 2

# 5) The NEUTRAL exit-2 verdict (jobs added after the judged run) -> exit 2.
EX="$(run_case "$(proof_run completed success)" "$LOG_PENDING" "$JOBS_ALL")"
expect "proof log is the PENDING/neutral verdict -> not-yet (exit 2)"   "$EX" 2

# 6) Proof log printed neither PENDING nor PASS -> inconclusive -> exit 2.
EX="$(run_case "$(proof_run completed success)" "$LOG_GARBAGE" "$JOBS_ALL")"
expect "proof log has no PASS/PENDING verdict -> inconclusive (exit 2)"  "$EX" 2

# 7) PASS verdict but no extractable audit run id in the log -> exit 2.
EX="$(run_case "$(proof_run completed success)" "$LOG_PASS_NOID" "$JOBS_ALL")"
expect "PASS but no judged-run id in log -> inconclusive (exit 2)"       "$EX" 2

# 8) No UNATTENDED schedule run yet (empty array) -> pre-first-tick PENDING -> 2.
EX="$(run_case "[]" "$LOG_PASS" "$JOBS_ALL")"
expect "no schedule proof run yet -> PENDING (exit 2)"                  "$EX" 2

# 9) Newest proof run still in progress (not completed) -> PENDING -> exit 2.
EX="$(run_case "$(proof_run in_progress '')" "$LOG_PASS" "$JOBS_ALL")"
expect "proof run still in_progress -> PENDING (exit 2)"               "$EX" 2

# 10) Empty proof log (gh/API blip reading logs) -> inconclusive -> exit 2.
EX="$(run_case "$(proof_run completed success)" "" "$JOBS_ALL")"
expect "empty proof log (gh blip) -> inconclusive (exit 2)"           "$EX" 2

# 11) Judged audit run jobs unreadable (empty) -> inconclusive -> exit 2.
EX="$(run_case "$(proof_run completed success)" "$LOG_PASS" "")"
expect "judged audit run jobs unreadable -> inconclusive (exit 2)"    "$EX" 2

# 12) gh run list errors (non-zero) -> inconclusive, never a false regression.
EX="$(run_case "" "$LOG_PASS" "$JOBS_ALL" 1)"
expect "gh run list errors -> inconclusive, not regression (exit 2)"  "$EX" 2

echo ""
if [ "$FAIL" -gt 0 ]; then
  red  "  $FAIL/$((PASS+FAIL)) scenarios MISMATCHED — capture-cron-proof.sh logic drifted."
  exit 1
fi
green "  ALL $PASS exit-path scenarios behave as specified — exit-0 capture & exit-1 mis-proven both proven offline."
exit 0
