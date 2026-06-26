#!/usr/bin/env bash
# ONE-COMMAND closeout orchestrator for the locked cron-proof mission.
#
# WHY THIS EXISTS (the gap it closes):
#   The mission's remaining step is NOT a single command — it is a 3-script sequence
#   that must run in a specific order, each with its own 3-way exit code:
#     1. assert-cron-proof-armed.sh        — is the NEXT tick going to capture? (preflight)
#     2. check-proof-verdict-contract.sh   — does capture still read what the producer writes?
#     3. record-cron-proof.sh              — is the genuine N-job exit-0 proof captured yet?
#                                            (durable wrapper over capture-cron-proof.sh — on a
#                                             win it ALSO appends the WIN block to a file so it
#                                             survives terminal scrollback; exit codes identical)
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
#   B2. DURABILITY next — gate C confirms the win by re-reading CRON-PROOF-CAPTURED.md.
#      That readback is the literal twin of the header record-cron-proof.sh WRITES. If
#      those two strings drift, a real durable proof reads as 'not durable' and gate C
#      FALSELY blocks — only after the 24h wait. So the durability-header handshake MUST
#      hold before we trust gate C's readback (symmetric with B, locks the OTHER half).
#   C. CAPTURE last     — only now is its verdict trustworthy. exit 0 ⇒ mission CLOSED.
#                         Uses record-cron-proof.sh (not the print-only capture) so the WIN
#                         block is durably written to CRON-PROOF-CAPTURED.md, not just echoed.
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
# Same default as record-cron-proof.sh so both resolve the SAME durable sink when
# neither is given RECORD_FILE — lets gate C VERIFY (not just assert) the on-disk win.
RECORD_FILE="${RECORD_FILE:-$(dirname "$SCRIPT_DIR")/CRON-PROOF-CAPTURED.md}"

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

# ── Gate B2: DURABILITY CONTRACT — does gate C's readback agree with the writer? ─
# Gate C (below) declares the mission CLOSED only after re-finding the WIN block on
# disk by grepping CRON-PROOF-CAPTURED.md. That readback is the LITERAL twin of the
# header record-cron-proof.sh writes. If those two strings ever drift (a future
# edit renames the header in one but not the other), the genuine, durable proof
# would be on disk yet gate C's grep would MISS it — a FALSE BLOCK surfacing only
# AFTER the ~24h tick wait. check-record-durability-contract.sh live-extracts both
# literals (plus record's sed extractor) and proves they still agree. We run it
# here, BEFORE trusting gate C's readback, so drift aborts with a clear "fix the
# header before the tick" message instead of a baffling post-tick false BLOCK.
# Symmetric with gate B, which locks the OTHER win-path handshake.
#   exit 1 = DRIFT → abort (gate C would mis-fire). exit 2 = INCONCLUSIVE (a source
#   line moved) → warn but CONTINUE: gate C's real on-disk readback is the backstop,
#   so an unprovable static check must not block a genuine win.
bold "[B2] durability ── check-record-durability-contract.sh"
rule
"$SCRIPT_DIR/check-record-durability-contract.sh"; B2=$?
rule
case "$B2" in
  1) red "[B2] DURABILITY DRIFT — record-cron-proof.sh's WIN-block header and gate C's"
     red "     readback grep no longer agree. A genuine, durable proof would be reported"
     red "     as 'not durable' and the closeout would FALSELY BLOCK after the tick."
     echo ""; red "BLOCKED (exit 1): durability-header handshake broken — fix the literals before the tick."; exit 1 ;;
  2) yellow "[B2] INCONCLUSIVE — a source line moved (refactor); could not statically prove the"
     yellow "     handshake. Continuing: gate C's real on-disk readback remains the backstop." ;;
  *) green "[B2] durability handshake intact — gate C's readback will re-find the written proof." ;;
esac
echo ""

# ── Gate C: CAPTURE — is the genuine unattended N-job exit-0 proof captured? ──
# Run via record-cron-proof.sh (durable wrapper) so a win is persisted to disk, not
# just printed — exit codes mirror capture-cron-proof.sh exactly (0/1/2).
bold "[C] capture    ── record-cron-proof.sh (durable wrapper over capture-cron-proof.sh)"
rule
"$SCRIPT_DIR/record-cron-proof.sh"; C=$?
rule
echo ""
case "$C" in
  0) # DURABILITY ASSERTION — record-cron-proof.sh exited 0, but VERIFY the WIN block
     # actually landed on disk before declaring victory. record-cron-proof.sh has a
     # silent no-write path: if capture exits 0 but its output carries no record block,
     # record WARNs and still exits 0 having written NOTHING (lines 39-42). A failed
     # append (read-only dir, full disk) is likewise invisible to the exit code. The
     # mission's success criteria explicitly require the proof be durable, so trust
     # the file, not the exit code.
     if [ ! -f "$RECORD_FILE" ] || ! grep -qE 'UNATTENDED .*-JOB EXIT-0 PROOF CAPTURED' "$RECORD_FILE" 2>/dev/null; then
       red "[C] capture exited 0 but the WIN block is NOT durably on disk:"
       red "      $RECORD_FILE"
       red "    record-cron-proof.sh returned 0 without persisting the proof (no-block WARN-skip,"
       red "    or a failed write). Refusing to declare CLOSED on an unverifiable proof."
       echo ""; red "BLOCKED (exit 1): proof not durable — re-run after confirming \$RECORD_FILE is writable."; exit 1
     fi
     green "════════════════════════════════════════════════════════════════"
     green " MISSION CLOSED — genuine UNATTENDED N-job exit-0 cron proof captured."
     green "════════════════════════════════════════════════════════════════"
     bold  " The WIN block is durably present in CRON-PROOF-CAPTURED.md (VERIFIED on disk)."
     bold  " Next: paste that record block into proof-armed-bidirectional-jobs-check.md"
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
