#!/usr/bin/env bash
# Capture-and-record the ONE-TIME unattended wall-clock proof that the cron-proof
# apparatus fired exit-0 with ALL expected audit jobs green at an UNATTENDED tick.
#
# WHY THIS EXISTS (the gap it closes):
#   The locked mission is to capture the genuine *unattended* exit-0 proof — not to
#   run check-schedule-fired.sh by hand (that is ATTENDED and proves only logic).
#   The real wall-clock proof is the schedule-fired-proof.yml WORKFLOW firing on its
#   own cron and the embedded verifier returning exit 0. But you CANNOT judge that
#   from the proof run's conclusion alone: schedule-fired-proof.yml maps BOTH
#   exit 0 (genuine proof) AND exit 2 (neutral PENDING) to run-conclusion `success`
#   — only exit 1 fails the run. So a `success` proof run is NOT proof on its own.
#
#   Worse, a proof run can print PASS (exit 0) yet cover FEWER jobs than expected:
#   at an older head SHA the verifier's JOBS default predated a later-added audit
#   job, so its exit-0 proved only the jobs it then knew about (the real 2026-06-26
#   14:17 tick proved 4 jobs, not the full 5). The genuine N-job proof needs a tick
#   where the judged audit run actually contains every expected job, each green.
#
# THE ROBUST, VERSION-INDEPENDENT DISCRIMINATOR this asserts:
#   1. There is a completed schedule (unattended) run of schedule-fired-proof.yml
#      on main, and it did NOT conclude `failure` (failure == verifier exit 1 ==
#      a real red/missing job → reported here as a regression, exit 1).
#   2. Its embedded verifier printed the exit-0 verdict line
#      "PASS ... fired UNATTENDED ... every required job is green" — NOT the
#      "PENDING ... added ... after the newest schedule run" exit-2 line. (These
#      verdict strings are emitted only as script OUTPUT; they are not present in
#      the workflow YAML source, so they cannot be confused with echoed commands.)
#   3. The audit schedule run that verdict judged contains EVERY expected audit job
#      id (parsed live from branch-protection-audit.yml at this HEAD), each
#      conclusion == success. This is what upgrades a stale 4-job PASS into the
#      full N-job proof, and auto-tracks if a 6th job is ever added.
#   When all hold, it prints a record-ready proof block (paste into
#   proof-armed-bidirectional-jobs-check.md) and exits 0.
#
# Usage:   ./scripts/capture-cron-proof.sh     (run from a clone checked out on main)
# Env:     REPO     (default d3hospitality/lingua-franca)
#          AUDIT_WF (default branch-protection-audit.yml)
#          PROOF_WF (default schedule-fired-proof.yml)
#          BRANCH   (default main)
# Exit:    0 = genuine unattended N-job exit-0 proof captured (record block printed)
#          1 = a schedule proof run concluded failure — an unattended REGRESSION
#          2 = not yet proven: no schedule proof run, still running, or the latest
#              proof was PENDING / covered fewer than the N expected jobs, or a
#              gh/API/auth blip. Never a false alarm — re-run after the next tick.

set -uo pipefail

REPO="${REPO:-d3hospitality/lingua-franca}"
AUDIT_WF="${AUDIT_WF:-branch-protection-audit.yml}"
PROOF_WF="${PROOF_WF:-schedule-fired-proof.yml}"
BRANCH="${BRANCH:-main}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
strip_ansi() { sed -E 's/\x1b\[[0-9;]*m//g'; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # .../lingua-franca-api/scripts
LF_API_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$LF_API_DIR")"
AUDIT_YML="$REPO_ROOT/.github/workflows/$AUDIT_WF"

bold "== capture-cron-proof :: is the unattended N-job exit-0 cron proof captured yet? =="
echo ""

# ── prerequisites (any failure here is INCONCLUSIVE, exit 2, never exit 1) ─────
for tool in gh jq; do
  command -v "$tool" >/dev/null 2>&1 || { yellow "  SKIP  $tool not found — cannot read run history."; exit 2; }
done
if ! gh auth status >/dev/null 2>&1 && [ -z "${GH_TOKEN:-}" ] && [ -z "${GITHUB_TOKEN:-}" ]; then
  yellow "  SKIP  gh is not authenticated and no GH_TOKEN/GITHUB_TOKEN set — run 'gh auth login'."
  exit 2
fi
if [ ! -f "$AUDIT_YML" ]; then
  yellow "  SKIP  cannot find $AUDIT_YML — run from a lingua-franca clone checked out on $BRANCH."
  exit 2
fi

# Expected audit job ids, parsed LIVE from the workflow at this HEAD (top-level keys
# under `jobs:`, 2-space indent) — same shape check-proof-armed.sh uses. The proof
# must cover every one of these, so the set auto-tracks job additions/removals.
EXPECTED_JOBS="$(awk '
  /^jobs:/        {injobs=1; next}
  injobs && /^[^[:space:]]/ {injobs=0}
  injobs && /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ {gsub(/[: ]/,""); print}
' "$AUDIT_YML")"
N_EXPECTED="$(printf '%s\n' $EXPECTED_JOBS | grep -c .)"
if [ "$N_EXPECTED" -lt 1 ]; then
  yellow "  SKIP  could not parse any job ids from $AUDIT_WF — cannot judge proof coverage."
  exit 2
fi
green "  ..    expecting $N_EXPECTED audit job(s): $(printf '%s ' $EXPECTED_JOBS)"

# ── 1. newest UNATTENDED (schedule) run of the proof workflow on main ──────────
PROOF_RUN_JSON="$(gh run list --repo "$REPO" --workflow "$PROOF_WF" --event schedule \
  --branch "$BRANCH" -L 1 --json databaseId,headSha,status,conclusion,createdAt 2>/dev/null)"
if [ -z "$PROOF_RUN_JSON" ] || [ "$PROOF_RUN_JSON" = "[]" ]; then
  yellow "  PENDING  no UNATTENDED (event=schedule) run of $PROOF_WF on $BRANCH yet — pre-first-tick."
  exit 2
fi
PROOF_ID="$(printf '%s' "$PROOF_RUN_JSON"  | jq -r '.[0].databaseId')"
PROOF_STATUS="$(printf '%s' "$PROOF_RUN_JSON" | jq -r '.[0].status')"
PROOF_CONCL="$(printf '%s' "$PROOF_RUN_JSON"  | jq -r '.[0].conclusion')"
PROOF_AT="$(printf '%s' "$PROOF_RUN_JSON"     | jq -r '.[0].createdAt')"
PROOF_URL="https://github.com/$REPO/actions/runs/$PROOF_ID"
echo  "  proof run #$PROOF_ID  ($PROOF_STATUS/$PROOF_CONCL)  $PROOF_AT"

if [ "$PROOF_STATUS" != "completed" ]; then
  yellow "  PENDING  newest schedule proof run is still '$PROOF_STATUS' — re-run once it completes. $PROOF_URL"
  exit 2
fi
if [ "$PROOF_CONCL" = "failure" ]; then
  red "  FAIL  schedule proof run #$PROOF_ID concluded FAILURE — the verifier hit exit 1: the cron"
  red "        fired but a required audit job was red/missing. Unattended REGRESSION. $PROOF_URL"
  exit 1
fi

# ── 2. read the embedded verifier's verdict from the proof run logs ───────────
LOG="$(gh run view "$PROOF_ID" --repo "$REPO" --log 2>/dev/null | strip_ansi)"
if [ -z "$LOG" ]; then
  yellow "  PENDING  could not read logs for proof run #$PROOF_ID (gh/API blip) — re-run. $PROOF_URL"
  exit 2
fi
if printf '%s' "$LOG" | grep -qE 'PENDING +the cron fired green, but'; then
  yellow "  PENDING  proof run #$PROOF_ID is a NEUTRAL exit-2 (verifier reported jobs added after the"
  yellow "           judged run) — not the genuine proof. Re-run after the next 13:17/13:30 tick. $PROOF_URL"
  exit 2
fi
if ! printf '%s' "$LOG" | grep -qE 'PASS +.*fired UNATTENDED'; then
  yellow "  PENDING  proof run #$PROOF_ID did not print the exit-0 'PASS ... UNATTENDED' verdict"
  yellow "           (inconclusive / unexpected output) — re-run after the next tick. $PROOF_URL"
  exit 2
fi

# ── 3. the audit run that verdict judged must cover EVERY expected job, green ──
AUDIT_ID="$(printf '%s' "$LOG" | grep -oE 'run +#[0-9]+' | head -1 | grep -oE '[0-9]+')"
if [ -z "$AUDIT_ID" ]; then
  yellow "  PENDING  could not extract the judged audit run id from proof run #$PROOF_ID logs. $PROOF_URL"
  exit 2
fi
AUDIT_JOBS_JSON="$(gh run view "$AUDIT_ID" --repo "$REPO" --json jobs 2>/dev/null)"
if [ -z "$AUDIT_JOBS_JSON" ]; then
  yellow "  PENDING  could not read jobs of judged audit run #$AUDIT_ID (gh/API blip) — re-run."
  exit 2
fi
MISSING=0
for id in $EXPECTED_JOBS; do
  jc="$(printf '%s' "$AUDIT_JOBS_JSON" | jq -r --arg n "$id" '.jobs[] | select(.name==$n) | .conclusion' | head -1)"
  if [ -z "$jc" ]; then
    yellow "  PARTIAL  expected job '$id' is NOT in judged audit run #$AUDIT_ID — this tick proved fewer"
    yellow "           than $N_EXPECTED jobs (stale/older-SHA proof). Await the next full-coverage tick."
    MISSING=1
  elif [ "$jc" != "success" ]; then
    red "  FAIL  expected job '$id' in audit run #$AUDIT_ID concluded '$jc', not success — regression."
    MISSING=2
  else
    green "  OK    job '$id' : success"
  fi
done
[ "$MISSING" -eq 2 ] && { red "MIS-PROVEN — a required job was non-green at the judged tick. $PROOF_URL"; exit 1; }
[ "$MISSING" -eq 1 ] && exit 2

# ── captured: emit a record-ready proof block ─────────────────────────────────
AUDIT_AT="$(printf '%s' "$LOG" | grep -E 'created +[0-9]' | head -1 | sed -E 's/.*created +//')"
echo ""
green "PROVEN — genuine UNATTENDED $N_EXPECTED-job exit-0 cron proof captured."
echo ""
bold  "  ── record-ready (paste into proof-armed-bidirectional-jobs-check.md) ──"
cat <<EOF
  UNATTENDED $N_EXPECTED-JOB EXIT-0 PROOF CAPTURED:
    proof workflow run : #$PROOF_ID (event=schedule, $BRANCH) $PROOF_AT — $PROOF_URL
    judged audit run   : #$AUDIT_ID${AUDIT_AT:+ ($AUDIT_AT)} — https://github.com/$REPO/actions/runs/$AUDIT_ID
    coverage           : all $N_EXPECTED expected jobs green: $(printf '%s ' $EXPECTED_JOBS)
    verdict            : schedule-fired-proof.yml fired on its own cron and check-schedule-fired.sh
                         returned exit 0 — the cron schedule itself (not manual dispatch) is proven.
EOF
exit 0
