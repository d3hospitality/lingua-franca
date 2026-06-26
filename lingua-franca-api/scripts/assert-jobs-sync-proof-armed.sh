#!/usr/bin/env bash
# Forward-looking READINESS gate for the LOG-LEVEL schedule-jobs-sync proof.
#
# WHY THIS EXISTS (the gap it closes, vs assert-cron-proof-armed.sh):
#   assert-cron-proof-armed.sh arms the ORIGINAL tick proof — it judges via
#   capture-cron-proof.sh / check-schedule-fired.sh, which only assert each audit
#   job CONCLUDED success. The jobs-sync saga added a DEEPER proof
#   (assert-schedule-jobs-sync-fired.sh): it reads the audit-schedule-jobs-sync
#   job's LOG on the cron run and asserts the literal "IN SYNC (exit 0)" marker —
#   log-level proof the drift guard actually RAN, not just that the step exited 0.
#   That deeper proof was auto-captured by schedule-fired-proof.yml's new
#   assert-jobs-sync-fired job (PR #46), but NOTHING gates whether the NEXT tick
#   will land it. Today the live closer reports exit 2 "added-after" — correct, but
#   INDISTINGUISHABLE from "silently broken, tomorrow's capture mis-fires" without a
#   gate that checks every precondition knowable BEFORE the wall clock advances.
#
#   This is the jobs-sync sibling of assert-cron-proof-armed.sh. It asserts the
#   NEXT 13:17/13:30Z tick WILL land the log-level exit-0 by proving, ahead of the
#   clock:
#     A. The live closer (assert-schedule-jobs-sync-fired.sh) is not already RED
#        (exit 1 == unattended regression) and not already CAPTURED (exit 0). If it
#        is exit 2, that pending state is expected pre-tick.
#     B. The CAPTURING job 'assert-jobs-sync-fired' is defined in the proof workflow
#        at this HEAD, so the 13:30 cron will actually run the closer.
#     C. The PRODUCING job 'audit-schedule-jobs-sync' is defined in the audit
#        workflow at this HEAD AND concluded success on the latest audit run on main
#        — so the 13:17 tick will produce a green job whose log carries the marker.
#     D. Both workflows are registered + active, so both crons WILL fire.
#
# Exit:  0 = ARMED — every precondition holds; the next tick WILL land the log-level
#            exit-0 (OR it is already captured: the closer exits 0 — nothing to arm).
#        1 = NOT ARMED — a precondition is broken; fix BEFORE the tick or tomorrow's
#            auto-capture mis-fires. (Also returned if the closer is already exit 1.)
#        2 = INCONCLUSIVE — missing tooling / gh auth / API blip; re-run. Never a
#            false alarm.
#
# Usage:  ./scripts/assert-jobs-sync-proof-armed.sh   (run from a clone on main)
# Env / test seams (mirror assert-cron-proof-armed.sh so the self-test can stub gh):
#   REPO, AUDIT_WF, PROOF_WF, BRANCH, PRODUCER_JOB, CAPTURE_JOB
#   ASSERT_BIN  override the live closer (assert-schedule-jobs-sync-fired.sh)
#   WF_DIR      override the .github/workflows dir (default: <repo root>/.github/workflows)

set -uo pipefail

REPO="${REPO:-d3hospitality/lingua-franca}"
AUDIT_WF="${AUDIT_WF:-branch-protection-audit.yml}"
PROOF_WF="${PROOF_WF:-schedule-fired-proof.yml}"
BRANCH="${BRANCH:-main}"
PRODUCER_JOB="${PRODUCER_JOB:-audit-schedule-jobs-sync}"
CAPTURE_JOB="${CAPTURE_JOB:-assert-jobs-sync-fired}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LF_API_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$LF_API_DIR")"
WF_DIR="${WF_DIR:-$REPO_ROOT/.github/workflows}"
AUDIT_YML="$WF_DIR/$AUDIT_WF"
PROOF_YML="$WF_DIR/$PROOF_WF"
ASSERT_BIN="${ASSERT_BIN:-$SCRIPT_DIR/assert-schedule-jobs-sync-fired.sh}"

# Is job id $2 defined (as a top-level `jobs:` child) in workflow file $1?
job_in_yml() {
  local file="$1" job="$2"
  [ -f "$file" ] || return 2
  awk -v want="$job" '
    /^jobs:/{j=1;next} j&&/^[^[:space:]]/{j=0}
    j&&/^  [a-zA-Z0-9_-]+:[[:space:]]*$/{n=$0;gsub(/[: ]/,"",n);if(n==want){found=1}}
    END{exit found?0:1}' "$file"
}

bold "== assert-jobs-sync-proof-armed :: will the NEXT tick land the LOG-LEVEL exit-0? =="
echo ""

# ── prerequisites (any failure here is INCONCLUSIVE, exit 2, never exit 1) ─────
for tool in gh jq; do
  command -v "$tool" >/dev/null 2>&1 || { yellow "  SKIP  $tool not found."; exit 2; }
done
if ! gh auth status >/dev/null 2>&1 && [ -z "${GH_TOKEN:-}" ] && [ -z "${GITHUB_TOKEN:-}" ]; then
  yellow "  SKIP  gh not authenticated and no GH_TOKEN/GITHUB_TOKEN — run 'gh auth login'."; exit 2
fi
[ -f "$AUDIT_YML" ] || { yellow "  SKIP  cannot find $AUDIT_YML — run from a clone on $BRANCH."; exit 2; }
[ -f "$PROOF_YML" ] || { yellow "  SKIP  cannot find $PROOF_YML — run from a clone on $BRANCH."; exit 2; }
[ -x "$ASSERT_BIN" ] || [ -f "$ASSERT_BIN" ] || { yellow "  SKIP  closer not found: $ASSERT_BIN"; exit 2; }

# ── A. defer to the live closer: already captured / already RED? ──────────────
ASSERT_OUT="$(bash "$ASSERT_BIN" 2>&1)"; A_RC=$?
case "$A_RC" in
  0) green "  A. assert-schedule-jobs-sync-fired.sh already exits 0 — log-level proof CAPTURED."
     echo ""; bold "ALREADY CAPTURED — mission closed. Nothing to arm."
     exit 0 ;;
  1) red "  A. assert-schedule-jobs-sync-fired.sh exits 1 — an UNATTENDED REGRESSION is on record."
     red "     The apparatus is NOT cleanly armed; investigate the red/marker-missing job first:"
     printf '%s\n' "$ASSERT_OUT" | sed 's/^/        /'
     exit 1 ;;
  2) green "  A. closer exits 2 (pending the tick) — no log-level regression on record." ;;
  *) yellow "  A. closer exited unexpectedly ($A_RC) — treat as inconclusive, re-run."; exit 2 ;;
esac

# ── B. the CAPTURING job exists in the proof workflow at this HEAD ─────────────
ARMED=1
if job_in_yml "$PROOF_YML" "$CAPTURE_JOB"; then
  green "  B. capturing job '$CAPTURE_JOB' is defined in $PROOF_WF — the 13:30 cron will run the closer."
else
  red "  B. capturing job '$CAPTURE_JOB' is ABSENT from $PROOF_WF — the closer will NOT run unattended."
  ARMED=0
fi

# ── C. the PRODUCING job exists in the audit workflow AND is green on latest run ─
if job_in_yml "$AUDIT_YML" "$PRODUCER_JOB"; then
  green "  C. producing job '$PRODUCER_JOB' is defined in $AUDIT_WF at this HEAD."
else
  red "  C. producing job '$PRODUCER_JOB' is ABSENT from $AUDIT_WF — the 13:17 tick will not emit its log."
  ARMED=0
fi

LATEST="$(gh run list --repo "$REPO" --workflow "$AUDIT_WF" --branch "$BRANCH" -L 1 \
  --json databaseId,event,status,conclusion,createdAt 2>/dev/null)"
if [ -z "$LATEST" ] || [ "$LATEST" = "[]" ]; then
  yellow "  SKIP  no $AUDIT_WF runs on $BRANCH yet — re-run."; exit 2
fi
LID="$(printf '%s' "$LATEST" | jq -r '.[0].databaseId')"
LST="$(printf '%s' "$LATEST" | jq -r '.[0].status')"
LEV="$(printf '%s' "$LATEST" | jq -r '.[0].event')"
LAT="$(printf '%s' "$LATEST" | jq -r '.[0].createdAt')"
echo "  C. latest audit run #$LID (event=$LEV, $LST) $LAT"
if [ "$LST" != "completed" ]; then
  yellow "  C. latest audit run still '$LST' — re-run once it finishes."; exit 2
fi
JOBS_JSON="$(gh run view "$LID" --repo "$REPO" --json jobs 2>/dev/null)"
[ -z "$JOBS_JSON" ] && { yellow "  SKIP  could not read jobs of run #$LID (gh/API blip) — re-run."; exit 2; }
PJC="$(printf '%s' "$JOBS_JSON" | jq -r --arg n "$PRODUCER_JOB" '.jobs[]|select(.name==$n)|.conclusion' | head -1)"
if [ -z "$PJC" ]; then
  # Absent from the latest run is EXPECTED while the job is newer than that run
  # (added-after): the workflow defines it, the run predates it. Not a regression —
  # the next tick is the first to contain it. The closer's own added-after logic
  # (exit 2) already covers this; here it is simply not a disqualifier for arming.
  yellow "  C. '$PRODUCER_JOB' not yet present in latest run #$LID (added-after) — expected pre-first-tick."
elif [ "$PJC" != "success" ]; then
  red "  C. '$PRODUCER_JOB' concluded '$PJC' on latest run #$LID — the next tick would MIS-fire its log."
  ARMED=0
else
  green "  C. '$PRODUCER_JOB' : success on latest run #$LID — its log will carry the IN-SYNC marker."
fi

# ── D. both workflows registered + active (so the crons WILL fire) ─────────────
WF_LIST="$(gh workflow list --repo "$REPO" --all --json path,state 2>/dev/null)"
[ -z "$WF_LIST" ] && { yellow "  SKIP  could not read workflow list (gh/API blip) — re-run."; exit 2; }
for wf in "$PROOF_WF:proof" "$AUDIT_WF:audit"; do
  name="${wf%%:*}"; label="${wf##*:}"
  state="$(printf '%s' "$WF_LIST" | jq -r --arg f "$name" \
    'map(select((.path|split("/")|last)==$f))|.[0].state // "MISSING"')"
  if [ "$state" = "active" ]; then
    green "  D. $label workflow '$name' is active — its cron will fire."
  else
    red "  D. $label workflow '$name' state='$state', not 'active' — its cron will NOT fire."
    ARMED=0
  fi
done

echo ""
if [ "$ARMED" -eq 1 ]; then
  green "ARMED — the next 13:17/13:30 UTC tick WILL land the LOG-LEVEL exit-0 jobs-sync proof."
  echo  "        Capturing + producing jobs are wired, both crons are active, and the producer"
  echo  "        is green (or correctly added-after). After the tick the auto-capture flips to 0."
  exit 0
fi
red "NOT ARMED — a precondition above is broken. Fix it BEFORE the next tick or the auto-capture mis-fires."
exit 1
