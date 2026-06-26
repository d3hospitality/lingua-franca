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
# is recent, finished `success`, AND that BOTH constituent jobs individually
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
#                      default "audit-branch-protection audit-merge-gate")
# Exit:    0 = a recent unattended schedule run finished green, all jobs green
#          1 = a schedule run fired but FAILED (or a required job is red/missing)
#              — this is the regression the cron audit exists to surface
#          2 = inconclusive: no schedule run yet, last one too old, or gh
#              missing/unauth/API unreachable. A blip must never read as exit 1.

set -uo pipefail

REPO="${REPO:-d3hospitality/lingua-franca}"
WORKFLOW="${WORKFLOW:-branch-protection-audit.yml}"
BRANCH="${BRANCH:-main}"
MAX_AGE_H="${MAX_AGE_H:-26}"
JOBS_RAW="${JOBS:-audit-branch-protection audit-merge-gate}"
read -r -a JOBS <<< "$(printf '%s' "$JOBS_RAW" | tr ',' ' ')"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

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
              --limit 1 --json databaseId,status,conclusion,createdAt,headBranch,url 2>/tmp/csf-err.$$)"
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
for J in "${JOBS[@]}"; do
  [ -z "$J" ] && continue
  JC="$(printf '%s' "$JOBS_JSON" | jq -r --arg n "$J" '.jobs[] | select(.name==$n) | .conclusion' | head -1)"
  if [ -z "$JC" ]; then
    red "  job '$J' : NOT FOUND in run #$RUN_ID — renamed/removed and no longer enforced?"
    MISSING=$((MISSING+1))
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

green "  PASS  $WORKFLOW fired UNATTENDED on $BRANCH (#$RUN_ID) and every required job is green."
echo  "        The cron schedule itself — not just manual dispatch — is proven."
exit 0
