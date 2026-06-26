#!/usr/bin/env bash
# Combined pre-tick GO/NO-GO for the locked cron-proof mission — one verdict, both routes.
#
# WHY THIS EXISTS (the gap it closes):
#   The mission can capture the genuine 5-job exit-0 proof via TWO independent routes:
#     route (2) REMOTE — GitHub's schedule-fired-proof.yml cron fires at 13:30Z and
#                        judges that day's branch-protection-audit tick. Verified by
#                        assert-cron-proof-armed.sh.
#     route (1) LOCAL  — the macOS LaunchAgent execs record-cron-proof.sh hands-off.
#                        Verified by assert-autorecord-live.sh.
#   Until now an operator had to run BOTH gates and merge the two verdicts in their
#   head to answer the only question that matters before the wall clock advances:
#   "will tomorrow's tick land the proof, and which route carries it?" That manual
#   merge is exactly where a degraded-but-not-dead state hides — e.g. route (1) DEAD
#   while route (2) is fine reads as scary in isolation but is actually a GO, because
#   the remote route is fully hands-off and load-bearing on its own.
#
#   This one-shot runs both gates, attributes the verdict to a route, and emits a
#   single GO/NO-GO so the pre-tick decision is unambiguous.
#
# Exit codes:
#   0  GO         — at least the REMOTE route is ARMED; the 13:17/13:30 tick WILL
#                   capture hands-off (local route reported as redundancy or degraded).
#   1  NO-GO      — the REMOTE route is NOT ARMED (the load-bearing path is broken).
#                   Fix BEFORE the tick or the one-shot mis-fires. A live exit-1 here
#                   means tomorrow's proof will NOT land unless you intervene.
#   2  INCONCLUSIVE — remote gate could not decide (gh auth / API blip / missing tool).
#                   Re-run. Never a false alarm.
#
# Test seams (used by preflight-tick-readiness.selftest.sh):
#   ARMED_BIN       override the remote-arming gate (assert-cron-proof-armed.sh)
#   AUTORECORD_BIN  override the local LaunchAgent gate (assert-autorecord-live.sh)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARMED="${ARMED_BIN:-$SCRIPT_DIR/assert-cron-proof-armed.sh}"
AUTORECORD="${AUTORECORD_BIN:-$SCRIPT_DIR/assert-autorecord-live.sh}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n'  "$1"; }
rule()  { printf '\033[1m%s\033[0m\n'  "────────────────────────────────────────────────────────────────"; }

bold "== preflight-tick-readiness :: will the NEXT 13:17/13:30Z tick land the exit-0 proof? =="
echo

# --- route (2) REMOTE: the load-bearing, fully-hands-off path ---------------
bold "[ROUTE 2 · REMOTE GitHub crons]  $ARMED"
if [ ! -x "$ARMED" ] && [ ! -f "$ARMED" ]; then
  red "  INCONCLUSIVE — remote-arming gate not found: $ARMED"
  exit 2
fi
bash "$ARMED"
remote_rc=$?
echo

# --- route (1) LOCAL: the macOS LaunchAgent path (reported, not load-bearing) ---
bold "[ROUTE 1 · LOCAL LaunchAgent]  $AUTORECORD"
if [ ! -x "$AUTORECORD" ] && [ ! -f "$AUTORECORD" ]; then
  yellow "  (skipped) local gate not found: $AUTORECORD"
  local_rc=3
else
  bash "$AUTORECORD"
  local_rc=$?
fi
echo
rule

# --- combined verdict -------------------------------------------------------
# Route-1 verdict labels mirror assert-autorecord-live.sh exit codes.
case "$local_rc" in
  0) local_label="ARMED (hands-off redundancy available)";;
  1) local_label="DEAD — TCC/Full Disk Access block; manual recorder still works";;
  2) local_label="PENDING — loaded, no exec recorded yet";;
  3) local_label="ABSENT — not loaded (install never ran / booted out)";;
  *) local_label="UNKNOWN (exit $local_rc)";;
esac

case "$remote_rc" in
  2)
    red "INCONCLUSIVE — the remote-arming gate could not decide (exit 2)."
    echo "  Re-run after checking gh auth / network. No GO/NO-GO call until remote is conclusive."
    echo "  Route 1 (local): $local_label"
    exit 2
    ;;
  1)
    red "NO-GO — the REMOTE route is NOT armed (assert-cron-proof-armed exit 1)."
    echo "  The load-bearing hands-off path is broken; fix it BEFORE the tick or tomorrow's"
    echo "  one-shot will mis-fire and the genuine exit-0 proof will not land."
    if [ "$local_rc" = "0" ]; then
      yellow "  Route 1 (local) is ARMED — it MAY still capture, but verify it actually execs"
      yellow "  under TCC before relying on it as the sole route."
    else
      echo "  Route 1 (local): $local_label  → no working fallback; remote must be fixed."
    fi
    exit 1
    ;;
  0)
    green "GO — the REMOTE route is ARMED; the next 13:17/13:30Z tick WILL capture hands-off."
    if [ "$local_rc" = "0" ]; then
      green "     Route 1 (local) is ALSO armed — redundant hands-off capture available."
    else
      yellow "     Route 1 (local): $local_label"
      echo "     Remote alone is sufficient. To revive local redundancy, grant Full Disk Access"
      echo "     to /bin/bash, then:  ./scripts/install-cron-proof-autorecord.sh"
    fi
    echo
    echo "  After the tick, close the mission with:  ./scripts/close-cron-proof-mission.sh"
    echo "  (or the manual recorder:  ./scripts/record-cron-proof.sh )"
    exit 0
    ;;
  *)
    red "INCONCLUSIVE — unexpected remote-gate exit ($remote_rc). Re-run."
    echo "  Route 1 (local): $local_label"
    exit 2
    ;;
esac
