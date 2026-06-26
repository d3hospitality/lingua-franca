#!/usr/bin/env bash
# Forward-looking READINESS gate for the locked cron-proof mission.
#
# WHY THIS EXISTS (the gap it closes):
#   capture-cron-proof.sh judges the *last* tick — until the 13:17/13:30 wall clock
#   advances it can only ever say "exit 2, PARTIAL, await the next tick". That is
#   correct but BLIND in one direction: it cannot tell "armed, just waiting for the
#   clock" apart from "silently broken — tomorrow's one-shot will MIS-fire". A newly
#   red audit job, a removed/disabled schedule-fired-proof.yml, or a de-registered
#   cron would all leave capture stuck at exit 2 looking identical to healthy waiting,
#   and the genuine exit-0 proof would never land — costing a full 24h to discover.
#
#   This gate asserts the NEXT tick WILL capture, by proving every precondition that
#   is knowable BEFORE the clock fires:
#     A. capture-cron-proof.sh is not already RED (exit 1 == unattended regression),
#        and if it is already exit 0 the mission is captured — nothing to arm.
#     B. The proof workflow schedule-fired-proof.yml is registered + active (so its
#        30 13 cron WILL fire) and the audit workflow it judges is active too.
#     C. The most recent branch-protection-audit run on main is completed/success and
#        contains EVERY expected job (parsed live from the workflow at this HEAD),
#        each green. The 13:17 cron runs that same workflow at that same (or later)
#        main SHA, so a fully-green latest run proves the next tick produces full
#        coverage → the 13:30 proof judges it → capture flips to exit 0.
#
# Exit:  0 = ARMED — every precondition holds; the next 13:17/13:30 tick will capture
#            (OR the proof is already captured: capture-cron-proof.sh exited 0).
#        1 = NOT ARMED — a precondition is broken; fix BEFORE the tick or the one-shot
#            mis-fires. (Also returned if capture itself reports an exit-1 regression.)
#        2 = INCONCLUSIVE — missing tooling / gh auth / API blip; re-run. Never a
#            false alarm.
#
# Usage:  ./scripts/assert-cron-proof-armed.sh   (run from a clone checked out on main)
# Env:    REPO (default d3hospitality/lingua-franca), AUDIT_WF, PROOF_WF, BRANCH

set -uo pipefail

REPO="${REPO:-d3hospitality/lingua-franca}"
AUDIT_WF="${AUDIT_WF:-branch-protection-audit.yml}"
PROOF_WF="${PROOF_WF:-schedule-fired-proof.yml}"
BRANCH="${BRANCH:-main}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LF_API_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$LF_API_DIR")"
AUDIT_YML="$REPO_ROOT/.github/workflows/$AUDIT_WF"

bold "== assert-cron-proof-armed :: will the NEXT 13:17/13:30 tick capture the exit-0 proof? =="
echo ""

# ── prerequisites (any failure here is INCONCLUSIVE, exit 2, never exit 1) ─────
for tool in gh jq; do
  command -v "$tool" >/dev/null 2>&1 || { yellow "  SKIP  $tool not found."; exit 2; }
done
if ! gh auth status >/dev/null 2>&1 && [ -z "${GH_TOKEN:-}" ] && [ -z "${GITHUB_TOKEN:-}" ]; then
  yellow "  SKIP  gh not authenticated and no GH_TOKEN/GITHUB_TOKEN — run 'gh auth login'."; exit 2
fi
[ -f "$AUDIT_YML" ] || { yellow "  SKIP  cannot find $AUDIT_YML — run from a clone on $BRANCH."; exit 2; }

# ── A. is the proof already captured / already RED? defer to the judge ────────
CAP_OUT="$("$SCRIPT_DIR/capture-cron-proof.sh" 2>&1)"; CAP_RC=$?
case "$CAP_RC" in
  0) green "  A. capture-cron-proof.sh already exits 0 — the proof is CAPTURED, nothing to arm."
     echo ""; bold "ALREADY CAPTURED — mission closed. Re-run capture-cron-proof.sh to reprint the block."
     exit 0 ;;
  1) red "  A. capture-cron-proof.sh exits 1 — an UNATTENDED REGRESSION is already on record."
     red "     The apparatus is NOT cleanly armed; investigate the red/missing job first:"
     printf '%s\n' "$CAP_OUT" | sed 's/^/        /'
     exit 1 ;;
  *) green "  A. capture-cron-proof.sh exits 2 (awaiting the tick) — no regression on record." ;;
esac

# ── expected job ids, parsed LIVE from the audit workflow at this HEAD ─────────
EXPECTED_JOBS="$(awk '
  /^jobs:/{j=1;next} j&&/^[^[:space:]]/{j=0}
  j&&/^  [a-zA-Z0-9_-]+:[[:space:]]*$/{gsub(/[: ]/,"");print}' "$AUDIT_YML")"
N_EXPECTED="$(printf '%s\n' $EXPECTED_JOBS | grep -c .)"
[ "$N_EXPECTED" -lt 1 ] && { yellow "  SKIP  could not parse job ids from $AUDIT_WF."; exit 2; }

# ── B. both workflows registered + active (so the crons WILL fire) ────────────
# gh workflow list keys by display name, not filename — match on the .path basename.
WF_LIST="$(gh workflow list --repo "$REPO" --all --json path,state 2>/dev/null)"
[ -z "$WF_LIST" ] && { yellow "  SKIP  could not read workflow list (gh/API blip) — re-run."; exit 2; }
ARMED_B=1
for wf in "$PROOF_WF:proof" "$AUDIT_WF:audit"; do
  name="${wf%%:*}"; label="${wf##*:}"
  state="$(printf '%s' "$WF_LIST" | jq -r --arg f "$name" \
    'map(select((.path|split("/")|last)==$f))|.[0].state // "MISSING"')"
  if [ "$state" = "active" ]; then
    green "  B. $label workflow '$name' is registered + active — its cron will fire."
  else
    red "  B. $label workflow '$name' state='$state', not 'active' — its cron will NOT fire."
    ARMED_B=0
  fi
done

# ── C. latest audit run on main is fully green across every expected job ───────
LATEST="$(gh run list --repo "$REPO" --workflow "$AUDIT_WF" --branch "$BRANCH" -L 1 \
  --json databaseId,event,status,conclusion,createdAt 2>/dev/null)"
[ -z "$LATEST" ] || [ "$LATEST" = "[]" ] && { yellow "  SKIP  no $AUDIT_WF runs on $BRANCH yet — re-run."; exit 2; }
LID="$(printf '%s' "$LATEST" | jq -r '.[0].databaseId')"
LST="$(printf '%s' "$LATEST" | jq -r '.[0].status')"
LCC="$(printf '%s' "$LATEST" | jq -r '.[0].conclusion')"
LEV="$(printf '%s' "$LATEST" | jq -r '.[0].event')"
LAT="$(printf '%s' "$LATEST" | jq -r '.[0].createdAt')"
echo "  C. latest audit run #$LID (event=$LEV, $LST/$LCC) $LAT"
ARMED_C=1
if [ "$LST" != "completed" ]; then
  yellow "  C. latest audit run still '$LST' — re-run once it finishes."; exit 2
fi
JOBS_JSON="$(gh run view "$LID" --repo "$REPO" --json jobs 2>/dev/null)"
[ -z "$JOBS_JSON" ] && { yellow "  SKIP  could not read jobs of run #$LID (gh/API blip) — re-run."; exit 2; }
for id in $EXPECTED_JOBS; do
  jc="$(printf '%s' "$JOBS_JSON" | jq -r --arg n "$id" '.jobs[]|select(.name==$n)|.conclusion' | head -1)"
  if [ -z "$jc" ]; then
    red "  C. expected job '$id' is MISSING from the latest audit run — next tick won't cover it."; ARMED_C=0
  elif [ "$jc" != "success" ]; then
    red "  C. expected job '$id' concluded '$jc', not success — next tick would MIS-fire on it."; ARMED_C=0
  else
    green "  C. job '$id' : success"
  fi
done

echo ""
if [ "$ARMED_B" -eq 1 ] && [ "$ARMED_C" -eq 1 ]; then
  green "ARMED — the next 13:17/13:30 UTC tick WILL capture the genuine $N_EXPECTED-job exit-0 proof."
  echo  "        Both crons are active and the latest main audit run is green across all $N_EXPECTED jobs."
  echo  "        After the tick, run: ./scripts/capture-cron-proof.sh   (then check-proof-verdict-contract.sh)"
  exit 0
fi
red "NOT ARMED — a precondition above is broken. Fix it BEFORE the next tick or the one-shot mis-fires."
exit 1
