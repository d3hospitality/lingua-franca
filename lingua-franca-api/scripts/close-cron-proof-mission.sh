#!/usr/bin/env bash
# ONE-COMMAND closeout orchestrator for the locked cron-proof mission.
#
# WHY THIS EXISTS (the gap it closes):
#   The mission's remaining step is NOT a single command — it is a 3-script sequence
#   that must run in a specific order, each with its own 3-way exit code:
#     1. assert-cron-proof-armed.sh        — is the NEXT tick going to capture? (preflight)
#     2. check-proof-verdict-contract.sh   — does capture still read what the producer writes?
#     3. capture-cron-proof.sh             — is the genuine N-job exit-0 proof captured yet?
#   Run out of order, or with #3's green verdict TRUSTED while #2's producer↔consumer
#   handshake has silently drifted, the "proof" is worthless. A human (or relay agent)
#   landing at the 13:30Z tick after a 24h wait should not have to re-derive that
#   ordering from memory. This wraps the sequence into ONE gated command with a single,
#   unambiguous closeout: it only declares the mission CLOSED when the handshake is
#   proven intact AND the unattended N-job exit-0 proof is in hand.
#
# GATING (why this order):
#   A. PREFLIGHT first  — fail fast: if the apparatus is NOT ARMED (a red audit job, a
#      de-registered cron), abort BEFORE trusting anything downstream; nothing to close.
#   B. CONTRACT next    — capture recognises the proof by grepping the producer's stdout.
#      If that handshake drifted, capture's exit 0 is a false pass. So the contract MUST
#      hold before we are willing to accept a green capture as proof.
#   C. CAPTURE last     — only now is its verdict trustworthy. exit 0 ⇒ mission CLOSED.
#
# Usage:   ./scripts/close-cron-proof-mission.sh   (run from a clone checked out on main,
#                                                    AFTER the 13:30Z tick for the win path)
# Exit:    0 = MISSION CLOSED — handshake intact + genuine unattended N-job exit-0 proof
#              captured (record block relayed below; paste it to close the thread).
#          2 = NOT YET — apparatus armed + handshake intact, but the proof is still PENDING
#              (pre-tick, or the last tick covered fewer than N jobs). Re-run after the
#              next 13:17/13:30 UTC tick. Never a false alarm.
#          1 = BLOCKED — a precondition is broken (NOT ARMED, contract drift, or an
#              unattended regression). Fix BEFORE the tick or the one-shot mis-fires.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
rule()  { printf '\033[2m%s\033[0m\n' "────────────────────────────────────────────────────────────────"; }

bold "== close-cron-proof-mission :: run the full closeout sequence in one shot =="
echo ""

# ── Gate A: PREFLIGHT — is the apparatus armed? ───────────────────────────────
bold "[A] preflight  ── assert-cron-proof-armed.sh"
rule
"$SCRIPT_DIR/assert-cron-proof-armed.sh"; A=$?
rule
case "$A" in
  1) red    "[A] NOT ARMED — a precondition for the next tick is broken. Fix it before the tick."
     echo ""; red "BLOCKED (exit 1): apparatus not armed — closeout aborted, did not trust anything downstream."; exit 1 ;;
  2) yellow "[A] INCONCLUSIVE — missing tooling / gh auth / API blip. Re-run."
     echo ""; yellow "NOT YET (exit 2): preflight inconclusive — re-run when gh/API is reachable."; exit 2 ;;
esac
green "[A] ARMED (or already captured) — continuing."
echo ""

# ── Gate B: CONTRACT — is the producer↔consumer handshake intact? ─────────────
bold "[B] handshake  ── check-proof-verdict-contract.sh"
rule
"$SCRIPT_DIR/check-proof-verdict-contract.sh"; B=$?
rule
if [ "$B" -ne 0 ]; then
  red "[B] CONTRACT DRIFT — capture-cron-proof.sh no longer reads what check-schedule-fired.sh writes."
  red "    A green capture would be a FALSE pass. Refusing to trust the capture verdict."
  echo ""; red "BLOCKED (exit 1): verdict handshake broken — fix the producer/consumer before trusting any capture."; exit 1
fi
green "[B] handshake intact — capture's verdict is trustworthy."
echo ""

# ── Gate C: CAPTURE — is the genuine unattended N-job exit-0 proof captured? ──
bold "[C] capture    ── capture-cron-proof.sh"
rule
"$SCRIPT_DIR/capture-cron-proof.sh"; C=$?
rule
echo ""
case "$C" in
  0) green "════════════════════════════════════════════════════════════════"
     green " MISSION CLOSED — genuine UNATTENDED N-job exit-0 cron proof captured."
     green "════════════════════════════════════════════════════════════════"
     bold  " Next: paste the record block above into proof-armed-bidirectional-jobs-check.md"
     bold  "       and report the locked cron-proof mission as CLOSED."
     exit 0 ;;
  2) yellow "NOT YET (exit 2): apparatus ARMED + handshake INTACT, but the proof is still PENDING."
     yellow "  (pre-tick, or the last tick covered fewer than N jobs.)"
     yellow "  Re-run this command after the next 13:17/13:30 UTC tick — it will flip to MISSION CLOSED."
     exit 2 ;;
  *) red "BLOCKED (exit 1): capture reported an UNATTENDED REGRESSION — a required job was non-green."
     red "  This is a real red, not a false alarm. Investigate the judged audit run above."
     exit 1 ;;
esac
