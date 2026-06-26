#!/usr/bin/env bash
# Asserts check-schedule-fired.sh's HARD-CODED `JOBS` default stays in 1:1 sync
# with the audit workflow's real `jobs:` list.
#
# WHY THIS EXISTS (the gap it closes):
#   capture-cron-proof.sh derives its expected-job set LIVE from the workflow YAML,
#   so a newly-added audit job auto-tracks there. check-schedule-fired.sh CANNOT do
#   that at a historical run's head SHA, so it carries a hard-coded JOBS default
#   (currently 6 jobs) and its header merely PROMISES it is "kept in 1:1 sync" with
#   the workflow. Nothing enforced that promise. Add a 7th audit job and forget to
#   extend the default and the schedule verifier silently checks only 6 — exactly
#   the "added-a-job, missed-a-touch" class the saga keeps re-learning (PR #23, the
#   3-touch lesson). This guard turns that comment promise into a tested invariant.
#
# It extracts BOTH lists from source (no network, no gh) and compares them as sets:
#   • workflow jobs : top-level keys under `jobs:` in branch-protection-audit.yml
#     (same awk shape capture-cron-proof.sh / check-proof-armed.sh use).
#   • default jobs  : the literal inside `${JOBS:-...}` in check-schedule-fired.sh.
#
# Exit codes:
#   0  IN SYNC          — the two sets are identical.
#   1  DRIFT            — a job is in one set but not the other; both deltas printed.
#   2  INCONCLUSIVE     — a source file is missing or neither list parses (never a
#                         silent green: an unparseable side is a failure, not a pass).
#
# Test seams (used by check-schedule-jobs-sync.selftest.sh):
#   AUDIT_YML   — path to the workflow file (default: repo .github/workflows/...).
#   VERIFIER    — path to check-schedule-fired.sh (default: this script's sibling).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # .../lingua-franca-api/scripts
LF_API_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$LF_API_DIR")"
AUDIT_WF="${AUDIT_WF:-branch-protection-audit.yml}"
AUDIT_YML="${AUDIT_YML:-$REPO_ROOT/.github/workflows/$AUDIT_WF}"
VERIFIER="${VERIFIER:-$SCRIPT_DIR/check-schedule-fired.sh}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

bold "== check-schedule-jobs-sync :: is check-schedule-fired's JOBS default == the workflow's jobs? =="
echo ""

[ -f "$AUDIT_YML" ] || { yellow "  SKIP  cannot find workflow: $AUDIT_YML"; exit 2; }
[ -f "$VERIFIER" ]  || { yellow "  SKIP  cannot find verifier: $VERIFIER"; exit 2; }

# ── workflow side: top-level job ids under `jobs:` (2-space indent) ─────────────
WF_JOBS="$(awk '
  /^jobs:/        {injobs=1; next}
  injobs && /^[^[:space:]]/ {injobs=0}
  injobs && /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ {gsub(/[: ]/,""); print}
' "$AUDIT_YML" | sort -u)"

# ── verifier side: the literal inside `${JOBS:-...}` (commas or spaces) ─────────
DEFAULT_RAW="$(sed -n 's/.*\${JOBS:-\([^}]*\)}.*/\1/p' "$VERIFIER" | head -1)"
VERIFIER_JOBS="$(printf '%s' "$DEFAULT_RAW" | tr ',' ' ' | tr ' ' '\n' | grep -E . | sort -u)"

N_WF="$(printf '%s\n' "$WF_JOBS" | grep -c .)"
N_VF="$(printf '%s\n' "$VERIFIER_JOBS" | grep -c .)"
if [ "$N_WF" -lt 1 ] || [ "$N_VF" -lt 1 ]; then
  yellow "  SKIP  could not parse a job list (workflow=$N_WF, verifier=$N_VF) — check the source shapes."
  exit 2
fi

green "  ..    workflow defines $N_WF job(s): $(printf '%s ' $WF_JOBS)"
green "  ..    verifier default $N_VF job(s): $(printf '%s ' $VERIFIER_JOBS)"
echo ""

# ── set diff both directions ───────────────────────────────────────────────────
MISSING_FROM_VERIFIER="$(comm -23 <(printf '%s\n' "$WF_JOBS") <(printf '%s\n' "$VERIFIER_JOBS"))"
STALE_IN_VERIFIER="$(comm -13 <(printf '%s\n' "$WF_JOBS") <(printf '%s\n' "$VERIFIER_JOBS"))"

if [ -z "$MISSING_FROM_VERIFIER" ] && [ -z "$STALE_IN_VERIFIER" ]; then
  green "IN SYNC (exit 0): check-schedule-fired's JOBS default matches the workflow's $N_WF jobs exactly."
  exit 0
fi

red "DRIFT (exit 1): check-schedule-fired's JOBS default is out of sync with the workflow."
[ -n "$MISSING_FROM_VERIFIER" ] && red "  in workflow but MISSING from verifier default: $(printf '%s ' $MISSING_FROM_VERIFIER)"
[ -n "$STALE_IN_VERIFIER" ]     && red "  in verifier default but STALE (not in workflow): $(printf '%s ' $STALE_IN_VERIFIER)"
red "  Fix: update the \${JOBS:-...} default in $VERIFIER to match the workflow's jobs."
exit 1
