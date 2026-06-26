#!/usr/bin/env bash
# Pre-flight for the CRON-PROOF apparatus — is it ARMED to fire correctly at the
# next tick, BEFORE the wall clock proves it?
#
# Three layers guard the unattended branch-protection-audit cron:
#   • check-schedule-fired.selftest.sh — proves the verifier's exit-code LOGIC
#     offline (stubbed gh). Says nothing about the live repo.
#   • check-schedule-fired.sh          — at/after the tick, proves the cron ACTUALLY
#     fired green. But only the wall clock can run it for real (13:17 / 13:30 UTC).
#   • THIS script                      — the gap between them: BEFORE the tick, it
#     asserts the live wiring is intact so the one-time wall-clock proof is not
#     wasted on a false-fail. Drift that only surfaces at 13:30 — a cron disabled by
#     repo inactivity, a job renamed out from under the verifier's JOBS default, the
#     proof workflow de-indexed — is caught here at any hour instead.
#
# It asserts, against the LIVE repo + the default-branch workflow copies (the copies
# schedule actually runs — memory: workflow-runs-default-branch-version):
#   1. branch-protection-audit.yml and schedule-fired-proof.yml are both registered
#      and state==active (a workflow GitHub disabled never ticks).
#   2. Each declares its expected cron, and the proof fires AFTER the audit on the
#      same hour (the coupling that lets the audit run reach `completed` first).
#   3. Every job id the audit defines is in the verifier's default JOBS list and has
#      NO job-level name: override — so the verifier's `.name==id` job match resolves
#      at the tick instead of false-failing "NOT FOUND".
#   4. The proof workflow actually invokes check-schedule-fired.sh and maps its exit
#      codes safely (exit 2 -> neutral, never a false alarm before the window).
#
# Usage:   ./scripts/check-proof-armed.sh        (run from a clone checked out on main)
# Env:     REPO        (default d3hospitality/lingua-franca)
#          AUDIT_WF    (default branch-protection-audit.yml)
#          PROOF_WF    (default schedule-fired-proof.yml)
#          VERIFIER    (default scripts/check-schedule-fired.sh, relative to repo root)
# Exit:    0 = apparatus fully armed — the next tick will produce a true proof
#          1 = mis-wired — a real regression that would waste/false the proof
#          2 = inconclusive: gh missing/unauth/API blip, or a workflow file absent
#              (cannot judge — never reported as exit 1)

set -uo pipefail

REPO="${REPO:-d3hospitality/lingua-franca}"
AUDIT_WF="${AUDIT_WF:-branch-protection-audit.yml}"
PROOF_WF="${PROOF_WF:-schedule-fired-proof.yml}"
VERIFIER="${VERIFIER:-scripts/check-schedule-fired.sh}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

# Locate the repo root so the script runs from anywhere in the clone. Workflow
# files live at <root>/.github/workflows; the verifier path is relative to root.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"          # .../lingua-franca-api/scripts
LF_API_DIR="$(dirname "$SCRIPT_DIR")"                               # .../lingua-franca-api
REPO_ROOT="$(dirname "$LF_API_DIR")"                                # clone root
WF_DIR="$REPO_ROOT/.github/workflows"
AUDIT_YML="$WF_DIR/$AUDIT_WF"
PROOF_YML="$WF_DIR/$PROOF_WF"
VERIFIER_ABS="$LF_API_DIR/$VERIFIER"

bold "== check-proof-armed :: is the cron-proof apparatus armed for the next tick? =="
echo ""

# ── prerequisites (any failure here is INCONCLUSIVE, exit 2, never exit 1) ─────
if ! command -v gh >/dev/null 2>&1; then
  yellow "  SKIP  gh CLI not found — cannot read workflow state. Install: https://cli.github.com"
  exit 2
fi
if ! gh auth status >/dev/null 2>&1 && [ -z "${GH_TOKEN:-}" ] && [ -z "${GITHUB_TOKEN:-}" ]; then
  yellow "  SKIP  gh is not authenticated and no GH_TOKEN/GITHUB_TOKEN set — run 'gh auth login'"
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  yellow "  SKIP  jq not found — cannot parse JSON. Install jq."
  exit 2
fi
for f in "$AUDIT_YML" "$PROOF_YML" "$VERIFIER_ABS"; do
  if [ ! -f "$f" ]; then
    yellow "  SKIP  expected file not found, cannot judge wiring: $f"
    yellow "        (run this from a lingua-franca clone checked out on main)"
    exit 2
  fi
done

FAIL=0   # flips to 1 on any hard mis-wiring → exit 1

# ── 1. both workflows registered AND active ───────────────────────────────────
WF_JSON="$(gh api "repos/$REPO/actions/workflows" --paginate 2>/tmp/cpa-wf.$$)"
if [ $? -ne 0 ] || [ -z "$WF_JSON" ]; then
  yellow "  SKIP  could not list workflows via gh api ($(cat /tmp/cpa-wf.$$ 2>/dev/null | head -1))"
  rm -f /tmp/cpa-wf.$$
  exit 2
fi
rm -f /tmp/cpa-wf.$$
for wf in "$AUDIT_WF" "$PROOF_WF"; do
  state="$(printf '%s' "$WF_JSON" | jq -r --arg p ".github/workflows/$wf" \
            '.workflows[] | select(.path==$p) | .state' | head -1)"
  if [ -z "$state" ]; then
    red   "  FAIL  $wf is NOT registered as a workflow — schedule cannot tick."
    FAIL=1
  elif [ "$state" != "active" ]; then
    red   "  FAIL  $wf state is '$state' (not active) — its cron is disabled and will not fire."
    FAIL=1
  else
    green "  OK    $wf registered and active."
  fi
done

# ── 2. crons present, and proof fires AFTER audit on the same hour ────────────
# Pull the first 'cron:' minute+hour from each workflow file (the default-branch
# copy in this clone). schedule runs ONLY this copy, so judging the file is right.
cron_of() { grep -oE "cron:[[:space:]]*'[^']+'" "$1" | head -1 | grep -oE "'[^']+'" | tr -d "'"; }
A_CRON="$(cron_of "$AUDIT_YML")"
P_CRON="$(cron_of "$PROOF_YML")"
A_MIN="$(printf '%s' "$A_CRON" | awk '{print $1}')"; A_HR="$(printf '%s' "$A_CRON" | awk '{print $2}')"
P_MIN="$(printf '%s' "$P_CRON" | awk '{print $1}')"; P_HR="$(printf '%s' "$P_CRON" | awk '{print $2}')"
if [ -z "$A_CRON" ] || [ -z "$P_CRON" ]; then
  red "  FAIL  could not read a cron schedule from one of the workflows (audit='$A_CRON' proof='$P_CRON')."
  FAIL=1
else
  green "  OK    audit cron '$A_CRON'   proof cron '$P_CRON'"
  # Same-hour ordering invariant: proof minute must be strictly later than audit's,
  # so the audit schedule run is `completed` (not in_progress=itself) when proof reads it.
  if [ "$A_HR" = "$P_HR" ] && printf '%s' "$A_MIN$P_MIN" | grep -qE '^[0-9]+$'; then
    if [ "$P_MIN" -le "$A_MIN" ]; then
      red "  FAIL  proof tick (:$P_MIN) is not strictly after audit tick (:$A_MIN) on hour $A_HR —"
      red "        proof would read the audit run still in_progress and never prove it (exit-2 forever)."
      FAIL=1
    else
      green "  OK    proof fires $((P_MIN - A_MIN)) min after audit on hour $A_HR — audit run is completed when judged."
    fi
  else
    yellow "  NOTE  audit and proof are on different hours ($A_HR vs $P_HR) — ordering not auto-checkable; verify by hand."
  fi
fi

# ── 3. verifier's default JOBS == audit's job ids, with no name: override ──────
# Job ids are the top-level keys under `jobs:` (2-space indent). A job-level
# `name:` (4-space indent, first key in the block) would make .name != id and break
# the verifier's `select(.name==id)` match at the tick.
AUDIT_JOB_IDS="$(awk '
  /^jobs:/        {injobs=1; next}
  injobs && /^[^[:space:]]/ {injobs=0}
  injobs && /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ {gsub(/[: ]/,""); print}
' "$AUDIT_YML")"
# verifier default JOBS list (strip comments/continuation, normalise commas→spaces)
VERIFIER_JOBS="$(grep -E 'JOBS_RAW=' "$VERIFIER_ABS" | head -1 | \
  sed -E 's/.*JOBS:-//; s/}".*//; s/"//g' | tr ',' ' ')"
if [ -z "$AUDIT_JOB_IDS" ] || [ -z "$VERIFIER_JOBS" ]; then
  yellow "  NOTE  could not parse job ids (audit) or JOBS default (verifier) — skipping job-coverage check."
else
  miss=0
  for id in $AUDIT_JOB_IDS; do
    if ! printf ' %s ' "$VERIFIER_JOBS" | grep -q " $id "; then
      red "  FAIL  audit job '$id' is NOT in the verifier's default JOBS — a silently green-overall"
      red "        run with this job skipped/red would pass the proof unnoticed."
      FAIL=1; miss=1
    fi
  done
  # a name: override on any job would break .name==id matching
  ovr="$(awk '
    /^jobs:/ {injobs=1; next}
    injobs && /^[^[:space:]]/ {injobs=0}
    injobs && /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ {curjob=$0; gsub(/[: ]/,"",curjob); injob=1; next}
    injob && /^    name:/ {print curjob; injob=0}
    injob && /^  [a-zA-Z0-9_-]+:/ {injob=0}
  ' "$AUDIT_YML")"
  if [ -n "$ovr" ]; then
    red "  FAIL  audit job(s) carry a job-level name: override ($ovr) — .name != job id, so the"
    red "        verifier's select(.name==id) match returns NOT FOUND at the tick (false exit 1)."
    FAIL=1
  fi
  if [ "$miss" -eq 0 ] && [ -z "$ovr" ]; then
    n=$(printf '%s\n' $AUDIT_JOB_IDS | grep -c .)
    green "  OK    all $n audit job id(s) covered by verifier JOBS, none has a name: override."
  fi
fi

# ── 4. proof workflow invokes the verifier and maps exit 2 -> neutral ─────────
if grep -q "check-schedule-fired.sh" "$PROOF_YML"; then
  green "  OK    proof workflow invokes check-schedule-fired.sh."
else
  red "  FAIL  proof workflow does NOT call check-schedule-fired.sh — it proves nothing."
  FAIL=1
fi
if grep -qE 'rc"?[[:space:]]*-eq[[:space:]]*2' "$PROOF_YML" || grep -q '::warning' "$PROOF_YML"; then
  green "  OK    proof workflow maps exit 2 to a neutral warning (no false alarm pre-window)."
else
  yellow "  NOTE  could not confirm the exit-2->neutral mapping in the proof workflow — verify by hand."
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  green "ARMED — every wiring check passed. The next 13:17 audit tick + 13:30 proof will yield a true result."
  exit 0
else
  red "MIS-WIRED — at least one check failed above. Fix before the next tick or the proof is wasted/false."
  exit 1
fi
