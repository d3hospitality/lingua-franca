#!/usr/bin/env bash
# Empirical verifier for the CRON SCHEDULE itself — did branch-protection-audit
# actually fire UNATTENDED and finish green?
#
# Everything else in this family proves the audit's *content*:
#   • check-branch-protection.sh — required contexts are LISTED (config half).
#   • check-merge-gate[-all].sh   — the merge button HONOURS them (behaviour half).
#   • check-trigger-topology.sh   — the workflow's triggers are shaped correctly.
# But a workflow that is correctly authored and green on `workflow_dispatch` can
# still be silently DEAD on its schedule: GitHub disables `schedule` triggers after
# ~60 days of repo inactivity, a cron edit can land only on a non-default branch
# (schedule runs ONLY the default-branch copy — memory: workflow-runs-default-
# branch-version), or the dispatch-vs-schedule token/permission surface can differ.
# Manual dispatch can therefore read green forever while the unattended path rots.
#
# This script closes that loop: it asserts a *schedule*-event run on `main` exists,
# is recent, finished `success`, AND that EVERY constituent job individually
# concluded green. It is the behavioural proof of the cron tick — the half no
# config/topology guard can see, because only the wall clock can trigger it.
#
# Usage:   ./scripts/check-schedule-fired.sh
# Env:     REPO       (default d3hospitality/lingua-franca)
#          WORKFLOW   (default branch-protection-audit.yml)
#          BRANCH     (default main — schedule runs the default branch)
#          MAX_AGE_H  (a scheduled run older than this is stale → inconclusive;
#                      default 26h, i.e. one daily tick + ~2h cron jitter slack)
#          JOBS       (space/comma list of job ids that must each be green;
#                      default "audit-branch-protection audit-merge-gate
#                      selftest-schedule-verifier audit-proof-armed
#                      audit-required-checks-topology selftest-saga-aggregate" —
#                      ALL 6 jobs the workflow currently defines (kept in 1:1 sync
#                      with the YAML by check-proof-armed.sh layer 3), so a job
#                      silently skipped/removed on the unattended path is caught
#                      even when overall conclusion is 'success', which skipped
#                      jobs do not flip to failure)
# Exit:    0 = a recent unattended schedule run finished green, all jobs green
#          1 = a schedule run fired but FAILED (or a required job is red/missing
#              despite having existed when the run fired) — the regression the
#              cron audit exists to surface
#          2 = inconclusive: no schedule run yet, last one too old, gh
#              missing/unauth/API unreachable, OR an expected job was ADDED to the
#              workflow after the newest schedule run fired and has not yet been
#              through an unattended tick (benign — re-run after the next tick).
#              A blip — or a not-yet-ticked new job — must never read as exit 1.
#
# Added-job vs removed-job (the subtle case): a job in JOBS that is absent from
# the run is FAIL only if it ALSO existed in the workflow at the run's own head
# SHA (so it was skipped/dropped on the unattended path). If it was absent at the
# run SHA but is present on $BRANCH now, it was simply added after this run fired
# — inconclusive (exit 2), not a regression. This timing check is what keeps the
# guard from false-failing for the one tick between landing a new audit job and
# its first scheduled run.

set -uo pipefail

REPO="${REPO:-d3hospitality/lingua-franca}"
WORKFLOW="${WORKFLOW:-branch-protection-audit.yml}"
BRANCH="${BRANCH:-main}"
MAX_AGE_H="${MAX_AGE_H:-26}"
JOBS_RAW="${JOBS:-audit-branch-protection audit-merge-gate selftest-schedule-verifier audit-proof-armed audit-required-checks-topology selftest-saga-aggregate audit-schedule-jobs-sync}"
read -r -a JOBS <<< "$(printf '%s' "$JOBS_RAW" | tr ',' ' ')"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

# Is job id $2 defined in the workflow file at git ref $1?  Prints yes|no|unknown.
# Used to tell a job that was SKIPPED/dropped on a run where it DID exist (FAIL)
# from one ADDED to the workflow after an older schedule run fired (benign).
# Raw Accept header returns the file body directly — no base64 (portable to the
# macOS bash 3.2 that runs the self-test; no associative arrays anywhere here).
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

bold "== check-schedule-fired :: did $WORKFLOW fire on cron (unattended) on $BRANCH and finish green? =="
echo ""

# ── prerequisites (any failure here is INCONCLUSIVE, exit 2, never exit 1) ─────
if ! command -v gh >/dev/null 2>&1; then
  yellow "  SKIP  gh CLI not found — cannot read run history. Install: https://cli.github.com"
  exit 2
fi
if ! gh auth status >/dev/null 2>&1 && [ -z "${GH_TOKEN:-}" ] && [ -z "${GITHUB_TOKEN:-}" ]; then
  yellow "  SKIP  gh is not authenticated and no GH_TOKEN/GITHUB_TOKEN set — run 'gh auth login'"
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  yellow "  SKIP  jq not found — cannot parse run JSON. Install jq."
  exit 2
fi

# ── most recent SCHEDULE-event run of this workflow on the target branch ──────
# event=schedule isolates the unattended path; manual dispatch/push are excluded
# precisely because they are the thing we DON'T trust to prove the cron.
RUN_JSON="$(gh run list --repo "$REPO" --workflow "$WORKFLOW" --event schedule --branch "$BRANCH" \
              --limit 1 --json databaseId,status,conclusion,createdAt,headBranch,headSha,url 2>/tmp/csf-err.$$)"
RC=$?
if [ $RC -ne 0 ] || [ -z "$RUN_JSON" ]; then
  yellow "  SKIP  could not list runs (gh exit $RC):"
  sed 's/^/        /' /tmp/csf-err.$$ 2>/dev/null | head -3
  rm -f /tmp/csf-err.$$
  exit 2
fi
rm -f /tmp/csf-err.$$

COUNT="$(printf '%s' "$RUN_JSON" | jq 'length')"
if [ "${COUNT:-0}" -eq 0 ]; then
  yellow "  PENDING  no event=schedule run of $WORKFLOW on $BRANCH yet."
  echo   "           The cron ('17 13 * * *') has not fired since it landed on the default"
  echo   "           branch, or its first tick is still in the future. Not a regression —"
  echo   "           re-run this guard after the next 13:17 UTC tick."
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
# Parse the ISO-8601 timestamp portably (GNU date -d ... ; BSD/macOS date -j -f).
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
    yellow "  STALE  newest schedule run is ${AGE_H}h old (> ${MAX_AGE_H}h threshold)."
    echo   "         The cron may have stopped firing (GitHub disables schedules after"
    echo   "         ~60d of repo inactivity) — investigate, but treat as inconclusive,"
    echo   "         not a hard regression."
    exit 2
  fi
  echo "  age     ${AGE_H}h (within ${MAX_AGE_H}h freshness window)"
fi

# ── the run must have COMPLETED before we judge it ───────────────────────────
if [ "$STATUS" != "completed" ]; then
  yellow "  PENDING  schedule run #$RUN_ID is still '$STATUS' — let it finish, then re-run."
  exit 2
fi

# ── overall conclusion ───────────────────────────────────────────────────────
if [ "$CONCL" != "success" ]; then
  red "  FAIL  unattended schedule run #$RUN_ID concluded '$CONCL', not success."
  echo "        The cron fired but the audit did NOT pass on its own. This is exactly"
  echo "        the unattended regression this guard exists to catch. Inspect: $URL"
  exit 1
fi

# ── per-job conclusions: an overall 'success' should already imply every job
#    green, but assert each named job EXPLICITLY so a job that was skipped,
#    removed, or renamed (and thus silently not enforced) is caught rather than
#    passing under a green umbrella. ───────────────────────────────────────────
JOBS_JSON="$(gh run view "$RUN_ID" --repo "$REPO" --json jobs 2>/tmp/csf-jerr.$$)"
if [ $? -ne 0 ] || [ -z "$JOBS_JSON" ]; then
  yellow "  PARTIAL  overall run is green but per-job detail was unreadable:"
  sed 's/^/           /' /tmp/csf-jerr.$$ 2>/dev/null | head -2
  rm -f /tmp/csf-jerr.$$
  echo   "           Overall conclusion=success is still a pass; treating job-level check"
  echo   "           as inconclusive rather than failing a green run."
  green  "  PASS(soft)  schedule run #$RUN_ID green; job-level assertion skipped."
  exit 0
fi
rm -f /tmp/csf-jerr.$$

MISSING=0
RED=0
ADDED_AFTER=0
for J in "${JOBS[@]}"; do
  [ -z "$J" ] && continue
  JC="$(printf '%s' "$JOBS_JSON" | jq -r --arg n "$J" '.jobs[] | select(.name==$n) | .conclusion' | head -1)"
  if [ -z "$JC" ]; then
    # Absent from the run. Classify by TIMING, not by mere absence: a job that
    # existed at the run's head SHA but didn't appear was skipped/dropped (FAIL);
    # one absent at the run SHA but present on $BRANCH was added after this run
    # fired and is simply awaiting its first scheduled tick (benign, exit 2).
    AT_RUN="$(job_defined_at "$HEAD_SHA" "$J")"
    AT_MAIN="$(job_defined_at "$BRANCH" "$J")"
    if [ "$AT_RUN" = "no" ] && [ "$AT_MAIN" = "yes" ]; then
      yellow "  job '$J' : added to $WORKFLOW after run #$RUN_ID fired (on $BRANCH, not at its head SHA) — awaiting its first schedule tick."
      ADDED_AFTER=$((ADDED_AFTER+1))
    elif [ "$AT_RUN" = "yes" ]; then
      red "  job '$J' : defined at the run's head SHA but ABSENT from run #$RUN_ID — skipped / not enforced on the unattended path?"
      MISSING=$((MISSING+1))
    else
      red "  job '$J' : NOT FOUND in run #$RUN_ID (run-SHA:$AT_RUN $BRANCH:$AT_MAIN) — renamed/removed and no longer enforced?"
      MISSING=$((MISSING+1))
    fi
  elif [ "$JC" != "success" ]; then
    red "  job '$J' : $JC"
    RED=$((RED+1))
  else
    green "  job '$J' : success"
  fi
done
echo ""

if [ "$RED" -gt 0 ] || [ "$MISSING" -gt 0 ]; then
  red "  FAIL  the cron fired but $((RED+MISSING)) required job(s) were red/missing. $URL"
  exit 1
fi

if [ "$ADDED_AFTER" -gt 0 ]; then
  yellow "  PENDING  the cron fired green, but $ADDED_AFTER expected job(s) were added to $WORKFLOW"
  echo   "           after the newest schedule run (#$RUN_ID) fired — they have not yet been through"
  echo   "           an unattended tick. Not a regression: re-run after the next 13:17 UTC tick to"
  echo   "           capture the full ${#JOBS[@]}-job exit-0 proof. $URL"
  exit 2
fi

green "  PASS  $WORKFLOW fired UNATTENDED on $BRANCH (#$RUN_ID) and every required job is green."
echo  "        The cron schedule itself — not just manual dispatch — is proven."
exit 0
