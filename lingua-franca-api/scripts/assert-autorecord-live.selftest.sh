#!/usr/bin/env bash
# Self-test for assert-autorecord-live.sh. Drives ALL FOUR verdicts (ARMED/DEAD/
# PENDING/ABSENT) offline by stubbing `launchctl` (a fake on PATH) plus the plist
# and log paths via the script's test seams — no real LaunchAgent, no real TCC.
# Mutation-proven at the end: break the EPERM guard and confirm the DEAD case
# stops being detected (so the test has teeth, not just coverage).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/assert-autorecord-live.sh"
LABEL="com.d3.lingua-franca.cron-proof-record"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
ok(){ printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
no(){ printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }

# Build a fake `launchctl` whose behaviour is driven by env files in $TMP:
#   $TMP/lc_loaded   -> if "1", `launchctl list` emits the LABEL line
#   $TMP/lc_exit     -> value emitted as "LastExitStatus" for `launchctl list LABEL`
mkdir -p "$TMP/bin"
cat > "$TMP/bin/launchctl" <<'STUB'
#!/usr/bin/env bash
sub="${1:-}"
case "$sub" in
  list)
    if [ "${2:-}" = "" ]; then
      # plain list: emit the label only when "loaded"
      [ "$(cat "$LC_STATE/lc_loaded" 2>/dev/null)" = "1" ] && \
        printf -- '-\t%s\tcom.d3.lingua-franca.cron-proof-record\n' "$(cat "$LC_STATE/lc_exit" 2>/dev/null || echo -)"
    else
      # `launchctl list LABEL`: emit a plist-ish dict with LastExitStatus
      ex="$(cat "$LC_STATE/lc_exit" 2>/dev/null)"
      [ -n "$ex" ] && printf '\t"LastExitStatus" = %s;\n' "$ex"
    fi
    ;;
esac
exit 0
STUB
chmod +x "$TMP/bin/launchctl"
export LC_STATE="$TMP"

run() { # run <plist_exists:0|1> <loaded:0|1> <exit_or_empty> <log_contents_or_empty>
  local plist_exists="$1" loaded="$2" exitv="$3" logtxt="$4"
  local plist="$TMP/agent.plist" log="$TMP/auto.log"
  rm -f "$plist" "$log"
  [ "$plist_exists" = "1" ] && : > "$plist"
  [ -n "$logtxt" ] && printf '%s\n' "$logtxt" > "$log"
  echo "$loaded" > "$TMP/lc_loaded"
  echo "$exitv"  > "$TMP/lc_exit"
  PATH="$TMP/bin:$PATH" LAUNCHCTL_BIN="$TMP/bin/launchctl" \
    PLIST_OVERRIDE="$plist" LOG_OVERRIDE="$log" \
    bash "$TARGET" >/dev/null 2>&1
  echo $?
}

echo "== assert-autorecord-live.selftest =="

# 1. ABSENT — plist missing entirely
[ "$(run 0 0 '' '')" = "3" ] && ok "ABSENT: no plist -> exit 3" || no "ABSENT: no plist"

# 2. ABSENT — plist exists but job not loaded
[ "$(run 1 0 '' '')" = "3" ] && ok "ABSENT: plist but unloaded -> exit 3" || no "ABSENT: plist but unloaded"

# 3. DEAD — loaded, last exit 126 (TCC, no log)
[ "$(run 1 1 126 '')" = "1" ] && ok "DEAD: exit 126 -> exit 1" || no "DEAD: exit 126"

# 4. DEAD — loaded, EPERM text in log even if exit looks benign
[ "$(run 1 1 0 'record-cron-proof.sh: Operation not permitted')" = "1" ] \
  && ok "DEAD: EPERM log text -> exit 1" || no "DEAD: EPERM log text"

# 4b. DEAD — loaded, raw waitpid-encoded 126 (32256), log rotated/empty
[ "$(run 1 1 32256 '')" = "1" ] && ok "DEAD: waitpid-encoded 126 (32256) -> exit 1" || no "DEAD: 32256"

# 5. PENDING — loaded, never ran (no exit, empty log)
[ "$(run 1 1 '' '')" = "2" ] && ok "PENDING: no exec yet -> exit 2" || no "PENDING: no exec yet"

# 6. ARMED — loaded, clean exit 0
[ "$(run 1 1 0 'pre-tick no-op')" = "0" ] && ok "ARMED: clean exit 0 -> exit 0" || no "ARMED: clean exit 0"

# 7. ARMED — loaded, clean exit 2 (recorder forwards exit 2 pre-tick)
[ "$(run 1 1 2 'awaiting tick')" = "0" ] && ok "ARMED: recorder exit 2 (pre-tick) -> exit 0" || no "ARMED: recorder exit 2"

# --- mutation test: neuter the EPERM/126 guard, the DEAD case must regress ---
echo "  -- mutation: break the DEAD (EPERM/126) guard --"
MUT="$TMP/mutant.sh"
sed 's/\[ "${EXITSTATUS:-}" = "126" \]/[ "${EXITSTATUS:-}" = "999" ]/; s/operation not permitted\\|not permitted/__never_matches__/' "$TARGET" > "$MUT"
echo "1" > "$TMP/lc_loaded"; echo "126" > "$TMP/lc_exit"
: > "$TMP/agent.plist"; printf 'Operation not permitted\n' > "$TMP/auto.log"
PATH="$TMP/bin:$PATH" LAUNCHCTL_BIN="$TMP/bin/launchctl" \
  PLIST_OVERRIDE="$TMP/agent.plist" LOG_OVERRIDE="$TMP/auto.log" \
  bash "$MUT" >/dev/null 2>&1
mut_rc=$?
if [ "$mut_rc" != "1" ]; then ok "mutation caught: broken guard no longer returns DEAD (got $mut_rc)"; else no "mutation NOT caught: mutant still returned 1"; fi

echo
echo "  PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "ALL GREEN"
