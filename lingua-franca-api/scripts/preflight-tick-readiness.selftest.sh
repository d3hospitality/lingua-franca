#!/usr/bin/env bash
# Self-test for preflight-tick-readiness.sh. Drives the full combined truth table
# offline by stubbing BOTH sub-gates (assert-cron-proof-armed.sh + assert-autorecord-
# live.sh) via the script's ARMED_BIN / AUTORECORD_BIN seams — no gh, no launchctl,
# no real TCC. The combined verdict keys off the REMOTE gate (load-bearing) with the
# LOCAL gate reported but never able to upgrade a remote NO-GO to GO. Mutation-proven
# at the end: make the remote NO-GO path return GO and confirm the harness catches it.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/preflight-tick-readiness.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
ok(){ printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
no(){ printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }

# A stub gate that just exits with the code in its first arg (passed via env file).
mkgate() { # mkgate <path> <exit_code>
  cat > "$1" <<STUB
#!/usr/bin/env bash
echo "stub gate exit $2"
exit $2
STUB
  chmod +x "$1"
}

run() { # run <remote_exit> <local_exit>  -> echoes preflight exit code
  local r="$1" l="$2"
  mkgate "$TMP/armed.sh" "$r"
  mkgate "$TMP/auto.sh"  "$l"
  ARMED_BIN="$TMP/armed.sh" AUTORECORD_BIN="$TMP/auto.sh" \
    bash "$TARGET" >/dev/null 2>&1
  echo $?
}

echo "== preflight-tick-readiness.selftest =="

# Remote ARMED (0) -> GO regardless of local state ----------------------------
[ "$(run 0 0)" = "0" ] && ok "remote ARMED + local ARMED      -> GO (0)"       || no "remote 0 / local 0"
[ "$(run 0 1)" = "0" ] && ok "remote ARMED + local DEAD       -> GO (0)"       || no "remote 0 / local 1"
[ "$(run 0 2)" = "0" ] && ok "remote ARMED + local PENDING    -> GO (0)"       || no "remote 0 / local 2"
[ "$(run 0 3)" = "0" ] && ok "remote ARMED + local ABSENT     -> GO (0)"       || no "remote 0 / local 3 (the LIVE state)"

# Remote NOT ARMED (1) -> NO-GO; local can NEVER upgrade it --------------------
[ "$(run 1 0)" = "1" ] && ok "remote NO-GO + local ARMED      -> NO-GO (1)"    || no "remote 1 / local 0"
[ "$(run 1 3)" = "1" ] && ok "remote NO-GO + local ABSENT     -> NO-GO (1)"    || no "remote 1 / local 3"

# Remote INCONCLUSIVE (2) -> INCONCLUSIVE -------------------------------------
[ "$(run 2 0)" = "2" ] && ok "remote INCONCLUSIVE             -> INCONCLUSIVE (2)" || no "remote 2 / local 0"

# Unexpected remote exit -> INCONCLUSIVE (never a false GO) --------------------
[ "$(run 7 0)" = "2" ] && ok "remote unexpected exit 7        -> INCONCLUSIVE (2)" || no "remote 7 / local 0"

# Missing remote gate -> INCONCLUSIVE (exit 2, no false GO) --------------------
rm -f "$TMP/armed.sh"; mkgate "$TMP/auto.sh" 3
rc="$(ARMED_BIN="$TMP/missing.sh" AUTORECORD_BIN="$TMP/auto.sh" bash "$TARGET" >/dev/null 2>&1; echo $?)"
[ "$rc" = "2" ] && ok "remote gate MISSING             -> INCONCLUSIVE (2)" || no "missing remote gate (got $rc)"

# --- mutation test: make the remote NO-GO path emit GO; harness must regress --
echo "  -- mutation: remote NO-GO (1) wrongly returns GO (exit 0) --"
MUT="$TMP/mutant.sh"
# In the remote_rc==1 case, flip the `exit 1` to `exit 0` (false GO on a broken remote).
sed '/^  1)/,/^    ;;/ s/    exit 1$/    exit 0/' "$TARGET" > "$MUT"
mkgate "$TMP/armed.sh" 1; mkgate "$TMP/auto.sh" 3
mut_rc="$(ARMED_BIN="$TMP/armed.sh" AUTORECORD_BIN="$TMP/auto.sh" bash "$MUT" >/dev/null 2>&1; echo $?)"
if [ "$mut_rc" = "0" ]; then
  ok "mutation caught: broken remote now MIS-reports GO (got $mut_rc; real script returns 1)"
else
  no "mutation NOT caught: mutant still returned $mut_rc (expected the flip to 0)"
fi

echo
echo "  PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "ALL GREEN"
