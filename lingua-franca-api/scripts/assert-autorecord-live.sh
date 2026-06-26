#!/usr/bin/env bash
# Verifies the LOCAL hands-off auto-capture path is actually alive — the half
# assert-cron-proof-armed.sh is blind to. That script confirms the REMOTE GitHub
# crons will produce the exit-0 proof; this one confirms the macOS LaunchAgent
# installed by install-cron-proof-autorecord.sh can actually EXEC record-cron-proof.sh
# at the tick. The repo lives under ~/Desktop (TCC-protected) and launchd does NOT
# inherit the Terminal's Full Disk Access, so the job can be "loaded" yet fail every
# run with EPERM / exit 126 ("Operation not permitted") — a silent dead-letter that
# makes "let the LaunchAgent fire" a no-op. This gate catches exactly that.
#
# Exit codes:
#   0  ARMED   — job loaded AND last exec was clean (pre-tick no-op or captured).
#   1  DEAD    — job loaded but last exec EPERM/TCC-blocked (126). Manual path required.
#   2  PENDING — job loaded but has not run yet (no LastExitStatus / no log).
#   3  ABSENT  — plist missing or job not loaded at all (install never ran / was booted out).
#
# Test seams (used by assert-autorecord-live.selftest.sh):
#   LAUNCHCTL_BIN  override the `launchctl` binary (stub it to script states)
#   PLIST_OVERRIDE override the plist path that must exist
#   LOG_OVERRIDE   override the autorecord log path that's scanned for EPERM text

set -uo pipefail

LABEL="com.d3.lingua-franca.cron-proof-record"
PLIST="${PLIST_OVERRIDE:-$HOME/Library/LaunchAgents/$LABEL.plist}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="${LOG_OVERRIDE:-$SCRIPT_DIR/../.cron-proof-autorecord.log}"
LAUNCHCTL="${LAUNCHCTL_BIN:-launchctl}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n'  "$1"; }

bold "== assert-autorecord-live :: will the LOCAL LaunchAgent actually fire record-cron-proof.sh at the tick? =="
echo

# --- ABSENT: plist gone or job not registered ------------------------------
if [ ! -f "$PLIST" ]; then
  red "ABSENT — plist not found: $PLIST"
  echo "  The hands-off LaunchAgent was never installed (or was uninstalled)."
  echo "  Install it:  ./scripts/install-cron-proof-autorecord.sh"
  exit 3
fi
if ! "$LAUNCHCTL" list 2>/dev/null | grep -q "$LABEL"; then
  red "ABSENT — plist exists but the job is NOT loaded in launchd: $LABEL"
  echo "  Load it:  ./scripts/install-cron-proof-autorecord.sh   (idempotent bootstrap)"
  exit 3
fi
green "  plist present and job is loaded: $LABEL"

# --- DEAD: launchd ran it but EPERM/TCC-blocked ----------------------------
# Two independent signals: the recorded LastExitStatus AND the literal EPERM text
# in the agent's stdout/stderr log. NOTE: launchctl reports the raw waitpid()
# status, so an exit code of 126 (not executable / permission denied) surfaces as
# 32256 (126 << 8). Match both the raw code and the encoded form.
EXITSTATUS="$("$LAUNCHCTL" list "$LABEL" 2>/dev/null | sed -n 's/.*"LastExitStatus" = \([0-9]*\);/\1/p')"

if grep -qi 'operation not permitted\|not permitted' "$LOG" 2>/dev/null \
   || [ "${EXITSTATUS:-}" = "126" ] || [ "${EXITSTATUS:-}" = "32256" ]; then
  red "DEAD — launchd cannot EXEC the recorder (TCC / Full Disk Access block; last exit=${EXITSTATUS:-?})."
  echo "  The job is loaded but every run fails with EPERM under ~/Desktop, so the tick"
  echo "  will be a silent no-op. Grant Full Disk Access to the launchd shell:"
  echo "    1. System Settings → Privacy & Security → Full Disk Access"
  echo "    2. Click +, press ⌘⇧G, enter:  /bin/bash   → Open → toggle it ON"
  echo "    3. Re-run:  ./scripts/install-cron-proof-autorecord.sh   (re-verifies)"
  yellow "  Until then the MANUAL path still works after the tick:  ./scripts/record-cron-proof.sh"
  exit 1
fi

# --- PENDING: loaded, no exec recorded yet ---------------------------------
if [ -z "${EXITSTATUS:-}" ] && [ ! -s "$LOG" ]; then
  yellow "PENDING — job loaded but has not run yet (no LastExitStatus, empty/absent log)."
  echo "  Force a dry exec to verify TCC now:  launchctl kickstart gui/\$(id -u)/$LABEL"
  echo "  Then re-run this gate."
  exit 2
fi

# --- ARMED: clean last exec ------------------------------------------------
green "  last launchd exec was clean (exit ${EXITSTATUS:-0}: pre-tick no-op or captured — no EPERM)."
echo
green "ARMED — the LOCAL LaunchAgent can exec record-cron-proof.sh; it WILL fire hands-off at the tick."
echo "        Pair with the remote gate:  ./scripts/assert-cron-proof-armed.sh"
exit 0
