#!/usr/bin/env bash
# Mission-closer: proves the audit-schedule-jobs-sync JOB actually reported
# "IN SYNC" on a REAL unattended cron tick (event=schedule), not merely that it
# concluded `success`.
#
# WHY THIS EXISTS (the gap it closes, vs check-schedule-fired.sh):
#   check-schedule-fired.sh asserts every audit job — including audit-schedule-
#   jobs-sync — CONCLUDED `success` on the schedule run. That proves the job's
#   step exited 0. It does NOT prove that exit-0 came from the guard's IN-SYNC
#   path. A future `continue-on-error: true`, a swapped/gutted step (`run: exit 0`),
#   or a renamed guard would all keep the job green while silently NOT enforcing
#   the JOBS-default↔workflow-jobs invariant. This verifier reads the job's LOG on
#   the event=schedule run and asserts check-schedule-jobs-sync.sh's literal
#   success line ("IN SYNC (exit 0)") was actually printed — log-level proof that
#   the drift guard ran and passed UNATTENDED. That is the last wall-clock gap for
#   the sync guard (see memory: schedule-jobs-sync-wired), closed at the 13:17 UTC
#   tick the merge-push run can never stand in for.
#
# Exit codes:
#   0  PROVEN        — a fresh event=schedule run on $BRANCH finished green, the
#                      audit-schedule-jobs-sync job concluded success, AND its log
#                      contains the IN-SYNC line. Mission closed.
#   1  REGRESSION    — the schedule run fired but the job is red, OR it is green
#                      yet its log is MISSING the IN-SYNC line (green via a path
#                      that does NOT prove the guard ran). Either is a real defect.
#   2  PENDING/INCONCLUSIVE — no event=schedule run yet (pre-tick), run still
#                      running, run stale, job added after the run fired, or the
#                      log/API was unreadable. Never a silent green: an unprovable
#                      state is exit 2, never exit 0.
#
# Env / test seams (mirrors check-schedule-fired.sh so the self-test can stub gh):
#   REPO, WORKFLOW, BRANCH, MAX_AGE_H, JOB, SYNC_MARKER.
set -uo pipefail

REPO="${REPO:-d3hospitality/lingua-franca}"
WORKFLOW="${WORKFLOW:-branch-protection-audit.yml}"
BRANCH="${BRANCH:-main}"
MAX_AGE_H="${MAX_AGE_H:-26}"
JOB="${JOB:-audit-schedule-jobs-sync}"
# The stable substring check-schedule-jobs-sync.sh prints ONLY on its exit-0 path.
SYNC_MARKER="${SYNC_MARKER:-IN SYNC (exit 0)}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

# Is job id $2 defined in the workflow file at git ref $1?  Prints yes|no|unknown.
# (Same shape check-schedule-fired.sh uses to tell skipped-vs-added-after apart.)
job_defined_at() {
  local ref="$1" job="$2" body
  body="$(gh api -H "Accept: application/vnd.github.raw" \
            "repos/$REPO/contents/.github/workflows/$WORKFLOW?ref=$ref" 2>/dev/null)"
  [ -z "$body" ] && { echo unknown; return; }
  if printf '%s\n' "$body" | grep -qE "^[[:space:]]+${job}:[[:space:]]*$"; then
    echo yes
  else
    echo no
  fi
}

bold "== assert-schedule-jobs-sync-fired :: did '$JOB' report IN SYNC on a real cron tick? =="
echo ""

# ── prerequisites (any failure here is INCONCLUSIVE, exit 2, never exit 1) ─────
if ! command -v gh >/dev/null 2>&1; then
  yellow "  SKIP  gh CLI not found — cannot read run history. Install: https://cli.github.com"; exit 2
fi
if ! gh auth status >/dev/null 2>&1 && [ -z "${GH_TOKEN:-}" ] && [ -z "${GITHUB_TOKEN:-}" ]; then
  yellow "  SKIP  gh is not authenticated and no GH_TOKEN/GITHUB_TOKEN set — run 'gh auth login'"; exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  yellow "  SKIP  jq not found — cannot parse run JSON. Install jq."; exit 2
fi

# ── most recent SCHEDULE-event run of this workflow on the target branch ──────
RUN_JSON="$(gh run list --repo "$REPO" --workflow "$WORKFLOW" --event schedule --branch "$BRANCH" \
              --limit 1 --json databaseId,status,conclusion,createdAt,headBranch,headSha,url 2>/tmp/asjs-err.$$)"
RC=$?
if [ $RC -ne 0 ] || [ -z "$RUN_JSON" ]; then
  yellow "  SKIP  could not list runs (gh exit $RC):"
  sed 's/^/        /' /tmp/asjs-err.$$ 2>/dev/null | head -3
  rm -f /tmp/asjs-err.$$
  exit 2
fi
rm -f /tmp/asjs-err.$$

COUNT="$(printf '%s' "$RUN_JSON" | jq 'length')"
if [ "${COUNT:-0}" -eq 0 ]; then
  yellow "  PENDING  no event=schedule run of $WORKFLOW on $BRANCH yet."
  echo   "           The cron ('17 13 * * *') has not fired since the sync guard landed."
  echo   "           Re-run this after the next 13:17 UTC tick to close the mission."
  exit 2
fi

RUN_ID="$(printf '%s' "$RUN_JSON" | jq -r '.[0].databaseId')"
STATUS="$(printf '%s' "$RUN_JSON" | jq -r '.[0].status')"
CONCL="$(printf '%s' "$RUN_JSON" | jq -r '.[0].conclusion')"
CREATED="$(printf '%s' "$RUN_JSON" | jq -r '.[0].createdAt')"
HEAD_SHA="$(printf '%s' "$RUN_JSON" | jq -r '.[0].headSha')"
URL="$(printf '%s' "$RUN_JSON" | jq -r '.[0].url')"

echo "  run     #$RUN_ID  ($STATUS/${CONCL:-—})"
echo "  created $CREATED"
echo "  url     $URL"
echo ""

# ── freshness: a green run from last week proves nothing about today's tick ──
EPOCH_RUN=""
if date -u -d "$CREATED" +%s >/dev/null 2>&1; then
  EPOCH_RUN="$(date -u -d "$CREATED" +%s)"
elif date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$CREATED" +%s >/dev/null 2>&1; then
  EPOCH_RUN="$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$CREATED" +%s)"
fi
if [ -n "$EPOCH_RUN" ]; then
  NOW="$(date -u +%s)"
  AGE_H=$(( (NOW - EPOCH_RUN) / 3600 ))
  if [ "$AGE_H" -gt "$MAX_AGE_H" ]; then
    yellow "  STALE  newest schedule run is ${AGE_H}h old (> ${MAX_AGE_H}h) — cron may have"
    echo   "         stopped firing; treat as inconclusive, not a regression."
    exit 2
  fi
  echo "  age     ${AGE_H}h (within ${MAX_AGE_H}h freshness window)"
fi

# ── the run must have COMPLETED before we judge it ───────────────────────────
if [ "$STATUS" != "completed" ]; then
  yellow "  PENDING  schedule run #$RUN_ID is still '$STATUS' — let it finish, then re-run."
  exit 2
fi

# ── locate the job within the run ────────────────────────────────────────────
JOBS_JSON="$(gh run view "$RUN_ID" --repo "$REPO" --json jobs 2>/tmp/asjs-jerr.$$)"
if [ $? -ne 0 ] || [ -z "$JOBS_JSON" ]; then
  yellow "  INCONCLUSIVE  could not read per-job detail for run #$RUN_ID:"
  sed 's/^/                /' /tmp/asjs-jerr.$$ 2>/dev/null | head -2
  rm -f /tmp/asjs-jerr.$$
  exit 2
fi
rm -f /tmp/asjs-jerr.$$

JOB_CONCL="$(printf '%s' "$JOBS_JSON" | jq -r --arg n "$JOB" '.jobs[] | select(.name==$n) | .conclusion' | head -1)"
JOB_DBID="$(printf '%s' "$JOBS_JSON" | jq -r --arg n "$JOB" '.jobs[] | select(.name==$n) | .databaseId' | head -1)"

if [ -z "$JOB_CONCL" ]; then
  # Absent. Classify by timing: a run that fired before the guard was wired won't
  # contain the job (benign, exit 2). A job that existed at the run SHA but is
  # missing was skipped/dropped (regression).
  AT_RUN="$(job_defined_at "$HEAD_SHA" "$JOB")"
  AT_MAIN="$(job_defined_at "$BRANCH" "$JOB")"
  if [ "$AT_RUN" = "no" ] && [ "$AT_MAIN" = "yes" ]; then
    yellow "  PENDING  '$JOB' was added after run #$RUN_ID fired (present on $BRANCH, absent at its"
    echo   "           head SHA) — it has not yet run on an unattended tick. Re-run after the next one."
    exit 2
  fi
  if [ "$AT_RUN" = "yes" ]; then
    red "  REGRESSION  '$JOB' is defined at the run's head SHA but ABSENT from run #$RUN_ID — skipped / not enforced unattended?"
    exit 1
  fi
  yellow "  INCONCLUSIVE  '$JOB' not found in run #$RUN_ID and its workflow presence is unverifiable (run-SHA:$AT_RUN $BRANCH:$AT_MAIN)."
  exit 2
fi

if [ "$JOB_CONCL" != "success" ]; then
  red "  REGRESSION  '$JOB' concluded '$JOB_CONCL' on unattended run #$RUN_ID — the sync guard FAILED on the cron path. Inspect: $URL"
  exit 1
fi
green "  job     '$JOB' concluded success on run #$RUN_ID"

# ── the deep proof: the job's LOG must carry the guard's IN-SYNC success line ──
# Conclusion=success only proves the step exited 0; the marker proves WHY.
if [ -z "$JOB_DBID" ] || [ "$JOB_DBID" = "null" ]; then
  yellow "  INCONCLUSIVE  job is green but its databaseId was unreadable — cannot fetch the log to"
  echo   "                confirm the IN-SYNC marker. Treating as inconclusive (not a silent pass)."
  exit 2
fi

LOG="$(gh run view --repo "$REPO" --job "$JOB_DBID" --log 2>/tmp/asjs-lerr.$$)"
if [ $? -ne 0 ] || [ -z "$LOG" ]; then
  yellow "  INCONCLUSIVE  job is green but its log was unreadable:"
  sed 's/^/                /' /tmp/asjs-lerr.$$ 2>/dev/null | head -2
  rm -f /tmp/asjs-lerr.$$
  echo   "                Cannot confirm the IN-SYNC marker — re-run (not a silent pass)."
  exit 2
fi
rm -f /tmp/asjs-lerr.$$

if printf '%s' "$LOG" | grep -qF "$SYNC_MARKER"; then
  echo ""
  green "PROVEN (exit 0): '$JOB' ran UNATTENDED on schedule run #$RUN_ID and its log reports"
  green "                 \"$SYNC_MARKER\" — the JOBS-default↔workflow drift guard passed on the"
  green "                 real cron tick, not just the merge-push. Wall-clock gap closed."
  exit 0
fi

red "REGRESSION (exit 1): '$JOB' is GREEN on run #$RUN_ID but its log is MISSING \"$SYNC_MARKER\"."
red "  The job exited 0 via a path that does NOT prove check-schedule-jobs-sync.sh ran and"
red "  passed (continue-on-error? swapped/gutted step? renamed guard?). Inspect: $URL"
exit 1
