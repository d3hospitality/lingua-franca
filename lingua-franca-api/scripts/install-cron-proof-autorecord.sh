#!/usr/bin/env bash
# Hands-off closeout for the cron-proof mission: installs a macOS LaunchAgent
# that runs record-cron-proof.sh once a day, so the durable exit-0 WIN block
# captures ITSELF the moment the 13:17/13:30 UTC tick lands — no agent needs to
# be dispatched at the right wall-clock moment.
#
# Why this is safe to run daily: record-cron-proof.sh forwards exit 2 (and writes
# nothing) until a genuine unattended N-job exit-0 proof exists in CI, then
# appends EXACTLY ONE stamped record block, idempotently. So the scheduled job is
# a no-op every day until the tick, fires once when the proof lands, and is an
# idempotent no-op forever after. Recurring-but-idempotent sidesteps launchd's
# lack of a true one-shot timer.
#
# launchd schedules in LOCAL time but the tick is UTC — so the local HH:MM for
# 13:35 UTC (5 min after the proof cron) is computed HERE, at install time,
# making the plist correct regardless of the machine's timezone / DST.
#
# Usage:  ./scripts/install-cron-proof-autorecord.sh           # install + load
#         ./scripts/install-cron-proof-autorecord.sh --uninstall
#         ./scripts/install-cron-proof-autorecord.sh --status

set -uo pipefail

LABEL="com.d3.lingua-franca.cron-proof-record"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECORDER="$SCRIPT_DIR/record-cron-proof.sh"
LOG="$SCRIPT_DIR/../.cron-proof-autorecord.log"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }

uid="$(id -u)"

case "${1:-}" in
  --uninstall)
    launchctl bootout "gui/$uid/$LABEL" 2>/dev/null \
      || launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    green "Uninstalled $LABEL (plist removed, job unloaded)."
    exit 0
    ;;
  --status)
    if launchctl list 2>/dev/null | grep -q "$LABEL"; then
      green "LOADED: $LABEL"
      launchctl list "$LABEL" 2>/dev/null | grep -E '"PID"|"LastExitStatus"' || true
    else
      yellow "NOT loaded: $LABEL"
    fi
    [ -f "$LOG" ] && { echo "--- last log lines ---"; tail -5 "$LOG"; }
    exit 0
    ;;
esac

# --- compute the local HH:MM that corresponds to 13:35 UTC (next tick + 5min) ---
read -r HH MM < <(python3 - <<'PY'
from datetime import datetime, timezone
utc = datetime(2026, 6, 27, 13, 35, tzinfo=timezone.utc)
loc = utc.astimezone()
print(loc.strftime('%H %M'))
PY
)
if [ -z "${HH:-}" ] || [ -z "${MM:-}" ]; then
  red "Could not compute local schedule time (python3 missing?). Aborting."
  exit 1
fi
# strip any leading zero so the plist integers are clean (09 -> 9)
HH=$((10#$HH)); MM=$((10#$MM))

[ -x "$RECORDER" ] || { red "Recorder not found/executable: $RECORDER"; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$RECORDER</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$HH</integer>
    <key>Minute</key><integer>$MM</integer>
  </dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLISTEOF

# (re)load idempotently — bootout the old one first, ignore "not loaded"
launchctl bootout "gui/$uid/$LABEL" 2>/dev/null || true
if launchctl bootstrap "gui/$uid" "$PLIST" 2>/dev/null \
   || launchctl load "$PLIST" 2>/dev/null; then
  green "Installed $LABEL"
  printf '  runs daily at %02d:%02d local (= 13:35 UTC) → %s\n' "$HH" "$MM" "$RECORDER"
  echo  "  writes the durable WIN block to CRON-PROOF-CAPTURED.md the day the tick lands;"
  echo  "  idempotent no-op every other day. Log: $LOG"
  echo  "  Check it:   ./scripts/install-cron-proof-autorecord.sh --status"
  echo  "  Remove it:  ./scripts/install-cron-proof-autorecord.sh --uninstall"
else
  red "Wrote $PLIST but launchctl load failed — load it manually with:"
  echo "  launchctl bootstrap gui/$uid \"$PLIST\""
  exit 1
fi

# --- post-install self-diagnosis: prove launchd can actually EXEC the recorder.
# The repo lives under ~/Desktop, which is TCC-protected; a launchd agent does
# NOT inherit the Terminal's Full Disk Access, so the very first exec can fail
# with EPERM ("Operation not permitted"). Surface that NOW with exact remediation
# instead of letting the job fail silently at the tick.
echo
yellow "Verifying launchd can run the recorder (pre-tick kickstart)…"
launchctl kickstart "gui/$uid/$LABEL" 2>/dev/null || true
sleep 3
EXITSTATUS="$(launchctl list "$LABEL" 2>/dev/null | sed -n 's/.*"LastExitStatus" = \([0-9]*\);/\1/p')"
if grep -qi 'operation not permitted\|not permitted' "$LOG" 2>/dev/null; then
  red   "TCC BLOCK — launchd cannot read the recorder under ~/Desktop (Full Disk Access needed)."
  echo  "  This job will FAIL at the tick until you grant Full Disk Access to the shell launchd uses:"
  echo  "    1. System Settings → Privacy & Security → Full Disk Access"
  echo  "    2. Click +, press ⌘⇧G, enter:  /bin/bash   → Open → toggle it ON"
  echo  "    3. Re-run:  ./scripts/install-cron-proof-autorecord.sh   (re-verifies)"
  echo  "  Until then, the manual path still works after the tick:  ./scripts/record-cron-proof.sh"
elif [ "${EXITSTATUS:-1}" = "2" ] || [ "${EXITSTATUS:-1}" = "0" ]; then
  green "VERIFIED — launchd ran the recorder cleanly (exit ${EXITSTATUS}: pre-tick no-op / captured). Hands-off closeout is armed."
else
  yellow "Kickstart exit=${EXITSTATUS:-?} (unexpected). Inspect the log: $LOG"
fi
