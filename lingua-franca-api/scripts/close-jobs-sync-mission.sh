#!/usr/bin/env bash
# ONE-COMMAND closeout orchestrator for the locked schedule-jobs-sync proof saga.
#
# WHY THIS EXISTS (the gap it closes, vs close-cron-proof-mission.sh):
#   close-cron-proof-mission.sh closes the ORIGINAL tick proof (conclusion-level:
#   each audit job CONCLUDED success). The jobs-sync saga added a DEEPER, log-level
#   proof — that the audit-schedule-jobs-sync drift guard actually RAN and printed
#   "IN SYNC (exit 0)" on an unattended cron run. Its terminal step is documented as
#   a TWO-command sequence (assert-jobs-sync-proof-armed.sh, then
#   assert-schedule-jobs-sync-fired.sh), each with its own 3-way exit code. A human
#   or relay agent landing at the 13:30Z tick after a ~24h wait should not have to
#   re-derive that ordering — or, worse, run the FIRED proof alone, see exit 2
#   PENDING, and wrongly conclude the apparatus is broken when it is merely pre-tick.
#   This wraps the sequence into ONE gated command with a single, unambiguous verdict.
#
# GATING (why this order):
#   A. ARMED first — fail fast: if the next tick will NOT capture (a red producer
#      job, a de-registered cron), abort BEFORE trusting the FIRED proof. A PENDING
#      FIRED result is only meaningful once we know the apparatus is genuinely armed;
#      otherwise PENDING could be masking a broken pipeline that never captures.
#   B. FIRED last — only now is its verdict trustworthy. exit 0 ⇒ the genuine
#      unattended log-level IN-SYNC proof is in hand ⇒ mission CLOSED.
#
# Unlike the cron-proof closeout, there are no contract/durability sub-gates here:
# assert-schedule-jobs-sync-fired.sh reads the job's LOG directly for the literal
# IN-SYNC marker — there is no producer↔consumer string handshake that can silently
# drift, so the green verdict needs no separate handshake guard.
#
# Usage:  ./scripts/close-jobs-sync-mission.sh   (run from a clone checked out on
#                                                 main, AFTER the 13:17/13:30Z tick
#                                                 for the win path)
# Exit:   0 = MISSION CLOSED — apparatus armed AND the genuine unattended log-level
#             exit-0 IN-SYNC proof is captured. Paste the FIRED block to close the saga.
#         2 = NOT YET — apparatus ARMED but the proof is still PENDING (pre-tick, run
#             still in progress, or the job was added after the last tick fired).
#             Re-run after the next 13:17/13:30 UTC tick. Never a false alarm.
#         1 = BLOCKED — a precondition is broken (NOT ARMED, or an unattended
#             REGRESSION: the job fired but was red / green-without-the-marker).
#             A real red — investigate before trusting any later capture.
#
# Env / test seams (let the self-test stub both gates without touching gh):
#   ARMED_BIN  override the armed gate (default: assert-jobs-sync-proof-armed.sh)
#   FIRED_BIN  override the fired proof (default: assert-schedule-jobs-sync-fired.sh)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARMED_BIN="${ARMED_BIN:-$SCRIPT_DIR/assert-jobs-sync-proof-armed.sh}"
FIRED_BIN="${FIRED_BIN:-$SCRIPT_DIR/assert-schedule-jobs-sync-fired.sh}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
rule()  { printf '\033[2m%s\033[0m\n' "────────────────────────────────────────────────────────────────"; }

bold "== close-jobs-sync-mission :: arm + prove the log-level IN-SYNC proof in one shot =="
echo ""

# ── Gate A: ARMED — will the next tick capture the log-level proof? ────────────
bold "[A] armed  ── assert-jobs-sync-proof-armed.sh"
rule
"$ARMED_BIN"; A=$?
rule
case "$A" in
  1) red    "[A] NOT ARMED — a precondition for the next tick is broken (red producer job,"
     red    "    de-registered cron). Tomorrow's auto-capture would mis-fire. Fix it first."
     echo ""; red "BLOCKED (exit 1): apparatus not armed — closeout aborted, did not trust the FIRED proof."; exit 1 ;;
  2) yellow "[A] INCONCLUSIVE — missing tooling / gh auth / API blip. Re-run when gh is reachable."
     echo ""; yellow "NOT YET (exit 2): armed gate inconclusive — re-run when gh/API is reachable."; exit 2 ;;
esac
green "[A] ARMED (or already captured) — the next tick WILL land the log-level proof. Continuing."
echo ""

# ── Gate B: FIRED — is the unattended log-level exit-0 IN-SYNC proof captured? ─
bold "[B] fired  ── assert-schedule-jobs-sync-fired.sh"
rule
"$FIRED_BIN"; B=$?
rule
echo ""
case "$B" in
  0) green "════════════════════════════════════════════════════════════════"
     green " MISSION CLOSED — genuine UNATTENDED log-level IN-SYNC cron proof captured."
     green "════════════════════════════════════════════════════════════════"
     bold  " The audit-schedule-jobs-sync job RAN on a real cron tick and its log carries"
     bold  " the literal 'IN SYNC (exit 0)' marker — deeper than conclusion=success."
     bold  " Next: paste the FIRED block above into schedule-jobs-sync-wired.md and report"
     bold  "       the locked schedule-jobs-sync proof saga as CLOSED."
     exit 0 ;;
  2) yellow "NOT YET (exit 2): apparatus ARMED, but the log-level proof is still PENDING."
     yellow "  (pre-tick, the run is still in progress, or the job was added after the last tick.)"
     yellow "  Re-run this command after the next 13:17/13:30 UTC tick — it will flip to MISSION CLOSED."
     exit 2 ;;
  *) red "BLOCKED (exit 1): the FIRED proof reported an UNATTENDED REGRESSION — the cron run"
     red "  fired but audit-schedule-jobs-sync was red, OR green without the IN-SYNC marker"
     red "  (green via a path that does NOT prove the guard ran). A real defect, not a false"
     red "  alarm. Investigate the judged schedule run above before trusting any capture."
     exit 1 ;;
esac
