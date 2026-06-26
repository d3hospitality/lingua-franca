#!/usr/bin/env bash
# Offline self-test for assert-jobs-sync-proof-armed.sh.
#
# Drives every exit path with a stubbed gh (fake-on-PATH, real jq), a stubbed
# closer (ASSERT_BIN), and fake workflow YAMLs (WF_DIR) — no network, no clone
# state required. Then mutation-tests the gate: deleting the ARMED=0 that the
# missing-capture-job branch sets must make a NOT-ARMED case wrongly PASS, proving
# the assertion has teeth (a guard that never fails proves nothing).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUT="$HERE/assert-jobs-sync-proof-armed.sh"
[ -f "$SUT" ] || { echo "FATAL: $SUT not found"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── fake workflow dir with both jobs present by default ───────────────────────
mk_wf() {           # $1=proof-has-capture(yes|no) $2=audit-has-producer(yes|no)
  mkdir -p "$WORK/wf"
  {
    echo "name: schedule-fired-proof"; echo "jobs:"
    echo "  assert-schedule-tick-fired:"; echo "    runs-on: ubuntu-latest"
    [ "$1" = "yes" ] && { echo "  assert-jobs-sync-fired:"; echo "    runs-on: ubuntu-latest"; }
  } > "$WORK/wf/schedule-fired-proof.yml"
  {
    echo "name: branch-protection-audit"; echo "jobs:"
    echo "  audit-branch-protection:"; echo "    runs-on: ubuntu-latest"
    [ "$2" = "yes" ] && { echo "  audit-schedule-jobs-sync:"; echo "    runs-on: ubuntu-latest"; }
  } > "$WORK/wf/branch-protection-audit.yml"
}

# ── stub closer: exits ${CLOSER_RC} ───────────────────────────────────────────
cat > "$WORK/closer.sh" <<'EOF'
#!/usr/bin/env bash
echo "stub closer (rc=${CLOSER_RC:-2})"
exit ${CLOSER_RC:-2}
EOF
chmod +x "$WORK/closer.sh"

# ── stub gh: dispatch on subcommand, emit env-controlled JSON ─────────────────
cat > "$WORK/gh" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  "auth status") exit 0 ;;
  "run list")
    echo "[{\"databaseId\":123,\"event\":\"${RUN_EVENT:-schedule}\",\"status\":\"${RUN_STATUS:-completed}\",\"conclusion\":\"success\",\"createdAt\":\"2026-06-27T13:17:00Z\"}]" ;;
  "run view")
    if [ -n "${PRODUCER_CONCL:-}" ]; then
      echo "{\"jobs\":[{\"name\":\"audit-schedule-jobs-sync\",\"conclusion\":\"${PRODUCER_CONCL}\"}]}"
    else
      echo "{\"jobs\":[{\"name\":\"audit-branch-protection\",\"conclusion\":\"success\"}]}"
    fi ;;
  "workflow list")
    echo "[{\"path\":\".github/workflows/schedule-fired-proof.yml\",\"state\":\"${PROOF_STATE:-active}\"},{\"path\":\".github/workflows/branch-protection-audit.yml\",\"state\":\"${AUDIT_STATE:-active}\"}]" ;;
  *) exit 0 ;;
esac
EOF
chmod +x "$WORK/gh"

PASS=0; FAIL=0
run_case() {  # $1=name $2=expected_rc ; remaining env set by caller via export
  local name="$1" exp="$2" got
  PATH="$WORK:$PATH" GH_TOKEN=x WF_DIR="$WORK/wf" ASSERT_BIN="$WORK/closer.sh" \
    bash "${SUT_OVERRIDE:-$SUT}" >/dev/null 2>&1
  got=$?
  if [ "$got" = "$exp" ]; then
    echo "  PASS  $name (exit $got)"; PASS=$((PASS+1))
  else
    echo "  FAIL  $name : expected $exp got $got"; FAIL=$((FAIL+1))
  fi
}

echo "== assert-jobs-sync-proof-armed.selftest =="

# 1. fully armed: both jobs present, producer green, both active, closer pending
mk_wf yes yes
CLOSER_RC=2 PRODUCER_CONCL=success PROOF_STATE=active AUDIT_STATE=active \
  run_case "ARMED (all preconditions hold)" 0

# 2. closer already exit 0 → already captured → 0
CLOSER_RC=0 run_case "already CAPTURED (closer exit 0)" 0

# 3. closer already exit 1 → regression on record → 1
CLOSER_RC=1 PRODUCER_CONCL=success run_case "already RED (closer exit 1)" 1

# 4. producer absent from latest run (added-after) but defined in yml → still ARMED (0)
mk_wf yes yes
CLOSER_RC=2 PRODUCER_CONCL= PROOF_STATE=active AUDIT_STATE=active \
  run_case "producer added-after (absent from latest run) → still ARMED" 0

# 5. producer RED on latest run → NOT ARMED (1)
CLOSER_RC=2 PRODUCER_CONCL=failure run_case "producer red on latest run → NOT ARMED" 1

# 6. capturing job missing from proof workflow → NOT ARMED (1)
mk_wf no yes
CLOSER_RC=2 PRODUCER_CONCL=success run_case "capturing job absent → NOT ARMED" 1

# 7. producing job missing from audit workflow → NOT ARMED (1)
mk_wf yes no
CLOSER_RC=2 PRODUCER_CONCL=success run_case "producing job absent → NOT ARMED" 1

# 8. proof workflow inactive → NOT ARMED (1)
mk_wf yes yes
CLOSER_RC=2 PRODUCER_CONCL=success PROOF_STATE=disabled_manually \
  run_case "proof workflow inactive → NOT ARMED" 1

# 9. latest audit run still running → INCONCLUSIVE (2)
CLOSER_RC=2 PRODUCER_CONCL=success RUN_STATUS=in_progress \
  run_case "latest audit run in_progress → INCONCLUSIVE" 2

# ── mutation test: strip the ARMED=0 from the missing-capture-job branch ──────
echo "-- mutation: missing-capture-job no longer disarms --"
MUT="$WORK/mutant.sh"
# Remove the ARMED=0 that immediately follows the 'capturing job ... ABSENT' red line.
awk '
  /capturing job .* is ABSENT from/ {print; skip=1; next}
  skip && /ARMED=0/ {skip=0; next}
  {print}
' "$SUT" > "$MUT"
chmod +x "$MUT"
mk_wf no yes
# Case 6 must now WRONGLY pass (exit 0) under the mutant — proving the guard had teeth.
CLOSER_RC=2 PRODUCER_CONCL=success \
  PATH="$WORK:$PATH" GH_TOKEN=x WF_DIR="$WORK/wf" ASSERT_BIN="$WORK/closer.sh" \
  bash "$MUT" >/dev/null 2>&1
mrc=$?
if [ "$mrc" = "0" ]; then
  echo "  PASS  mutant wrongly ARMED (exit 0) — original guard has teeth"; PASS=$((PASS+1))
else
  echo "  FAIL  mutant still exit $mrc — mutation not effective / guard untested"; FAIL=$((FAIL+1))
fi

echo ""
echo "== $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
