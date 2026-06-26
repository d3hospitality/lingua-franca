#!/usr/bin/env bash
# Self-test for check-proof-armed.sh — drives EVERY exit path of the cron-proof
# pre-flight arming guard offline by stubbing `gh` and building a throwaway clone
# tree, so its ARMED (exit 0), MIS-WIRED (exit 1) and INCONCLUSIVE (exit 2)
# branches are PROVEN WITHOUT a live repo or the 13:17/13:30 UTC tick.
#
# Why this exists: check-proof-armed.sh is the `audit-proof-armed` job — one of
# the six jobs the unattended tick must pass green — and it was the ONLY saga
# guard with no offline self-test. Every other guard (capture, record, schedule-
# fired, durability-contract, autorecord, preflight, closeout) is locked by a
# *.selftest.sh that run-saga-selftests.sh discovers and the 6th CI job executes.
# This guard's four wiring checks (workflow active, proof-after-audit ordering,
# verifier JOBS 1:1 with audit job ids, proof invokes the verifier) had their
# exit-1 FAIL branches never exercised offline — a stealth edit that dropped a
# `FAIL=1` would silently report ARMED on a mis-wired apparatus and waste the
# one-time wall-clock proof. This harness closes that blind spot. Because the
# aggregate auto-discovers *.selftest.sh, this file joins the 6th CI job with no
# extra wiring (8/8 -> 9/9).
#
# How it works: a fake `gh` is placed first on PATH (real jq is kept — the
# script's JSON parsing is under test). Per scenario the harness writes a minimal
# clone tree under a tmpdir — .github/workflows/{audit,proof}.yml plus
# lingua-franca-api/scripts/{check-proof-armed.sh (the real copy under test),
# check-schedule-fired.sh (a JOBS_RAW stub)} — mutates exactly one wiring fact,
# runs the copied target from inside that tree, and asserts its exit code.
#
# Usage:   ./scripts/check-proof-armed.selftest.sh
# Exit:    0 = all scenarios produced the expected exit code, 1 = a mismatch,
#          2 = prerequisite missing (jq or the target script).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="$SCRIPT_DIR/check-proof-armed.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0
FAIL=0

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

if ! command -v jq >/dev/null 2>&1; then
  yellow "  SKIP  jq not found — this harness needs the real jq to test JSON parsing."; exit 2
fi
if [ ! -f "$TARGET" ]; then
  red "  FAIL  cannot find target under test: $TARGET"; exit 2
fi

# ── fake gh on PATH ──────────────────────────────────────────────────────────
# Handles only the two subcommands check-proof-armed.sh calls:
#   gh auth status        -> exit 0 (or 1 when FAKE_GH_AUTH=bad)
#   gh api .../workflows  -> cat $FAKE_GH_WF_JSON (or exit 1 when FAKE_GH_API=err)
GHDIR="$TMP/bin"
mkdir -p "$GHDIR"
cat > "$GHDIR/gh" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  auth) [ "${FAKE_GH_AUTH:-ok}" = ok ] && exit 0 || exit 1 ;;
  api)  if [ "${FAKE_GH_API:-ok}" = err ]; then echo "fake gh: API blip" >&2; exit 1; fi
        cat "$FAKE_GH_WF_JSON"; exit 0 ;;
  *)    exit 0 ;;
esac
EOF
chmod +x "$GHDIR/gh"

CLONE="$TMP/clone"
WF="$CLONE/.github/workflows"
SCR="$CLONE/lingua-franca-api/scripts"
WFJSON="$TMP/wf.json"

# Write a fully-armed fixture tree. Scenario fns mutate one fact then run_target.
setup_good() {
  rm -rf "$CLONE"
  mkdir -p "$WF" "$SCR"
  cp "$TARGET" "$SCR/check-proof-armed.sh"
  cat > "$WF/branch-protection-audit.yml" <<'YML'
name: branch-protection-audit
on:
  schedule:
    - cron: '17 13 * * *'
jobs:
  audit-branch-protection:
    runs-on: ubuntu-latest
  audit-merge-gate:
    runs-on: ubuntu-latest
YML
  cat > "$WF/schedule-fired-proof.yml" <<'YML'
name: schedule-fired-proof
on:
  schedule:
    - cron: '30 13 * * *'
jobs:
  proof:
    runs-on: ubuntu-latest
    steps:
      - run: |
          bash scripts/check-schedule-fired.sh; rc=$?
          if [ "$rc" -eq 2 ]; then echo "::warning::pending"; fi
YML
  cat > "$SCR/check-schedule-fired.sh" <<'SH'
#!/usr/bin/env bash
JOBS_RAW="${JOBS:-audit-branch-protection audit-merge-gate}"
SH
  cat > "$WFJSON" <<'JSON'
{"workflows":[
  {"path":".github/workflows/branch-protection-audit.yml","state":"active"},
  {"path":".github/workflows/schedule-fired-proof.yml","state":"active"}
]}
JSON
}

# Run the copied target from inside the fake clone with the fake gh first on PATH.
# Tokens are unset so the auth gate is decided solely by the fake gh (deterministic
# in CI, where GITHUB_TOKEN is otherwise present).
run_target() {
  ( cd "$SCR" && env -u GH_TOKEN -u GITHUB_TOKEN \
      PATH="$GHDIR:$PATH" FAKE_GH_WF_JSON="$WFJSON" \
      FAKE_GH_AUTH="${FAKE_GH_AUTH:-ok}" FAKE_GH_API="${FAKE_GH_API:-ok}" \
      bash "$SCR/check-proof-armed.sh" >/dev/null 2>&1 )
  echo $?
}

# assert <expected-exit> <label>   (caller sets up fixtures first)
assert() {
  local want="$1" label="$2" got
  got="$(run_target)"
  if [ "$got" = "$want" ]; then
    green "  PASS  $label  (exit $got)"; PASS=$((PASS+1))
  else
    red   "  FAIL  $label  (expected $want, got $got)"; FAIL=$((FAIL+1))
  fi
}

bold "== check-proof-armed.selftest :: every exit path of the arming guard, offline =="
echo ""

# ── exit 0 : fully armed ──────────────────────────────────────────────────────
setup_good
assert 0 "[1] all wiring intact -> ARMED"

# ── exit 1 : MIS-WIRED branches ───────────────────────────────────────────────
setup_good
# proof workflow marked disabled -> its cron will not fire
sed -i.bak 's#\("path":".github/workflows/schedule-fired-proof.yml","state":\)"active"#\1"disabled_inactivity"#' "$WFJSON"
assert 1 "[2] proof workflow not active -> MIS-WIRED"

setup_good
# proof workflow absent from the registry listing
cat > "$WFJSON" <<'JSON'
{"workflows":[{"path":".github/workflows/branch-protection-audit.yml","state":"active"}]}
JSON
assert 1 "[3] proof workflow not registered -> MIS-WIRED"

setup_good
# proof cron == audit cron (not strictly after, same hour) -> exit-2-forever trap
sed -i.bak "s/cron: '30 13/cron: '17 13/" "$WF/schedule-fired-proof.yml"
assert 1 "[4] proof tick not after audit tick -> MIS-WIRED"

setup_good
# audit gains a job that the verifier JOBS default does NOT cover (forward gap)
cat >> "$WF/branch-protection-audit.yml" <<'YML'
  audit-new-job:
    runs-on: ubuntu-latest
YML
assert 1 "[5] audit job missing from verifier JOBS -> MIS-WIRED"

setup_good
# verifier JOBS lists a job that no longer exists in the audit (reverse/stale gap)
cat > "$SCR/check-schedule-fired.sh" <<'SH'
#!/usr/bin/env bash
JOBS_RAW="${JOBS:-audit-branch-protection audit-merge-gate audit-ghost}"
SH
assert 1 "[6] stale verifier JOBS entry -> MIS-WIRED"

setup_good
# a job-level name: override breaks the verifier's select(.name==id) match
cat > "$WF/branch-protection-audit.yml" <<'YML'
name: branch-protection-audit
on:
  schedule:
    - cron: '17 13 * * *'
jobs:
  audit-branch-protection:
    name: Pretty Name
    runs-on: ubuntu-latest
  audit-merge-gate:
    runs-on: ubuntu-latest
YML
assert 1 "[7] job-level name: override -> MIS-WIRED"

setup_good
# proof workflow no longer invokes the verifier -> proves nothing
cat > "$WF/schedule-fired-proof.yml" <<'YML'
name: schedule-fired-proof
on:
  schedule:
    - cron: '30 13 * * *'
jobs:
  proof:
    runs-on: ubuntu-latest
    steps:
      - run: echo "I do nothing useful"
YML
assert 1 "[8] proof does not invoke the verifier -> MIS-WIRED"

# ── exit 2 : INCONCLUSIVE branches (never a false exit 1) ──────────────────────
setup_good
FAKE_GH_AUTH=bad assert 2 "[9] gh unauthenticated -> INCONCLUSIVE"

setup_good
FAKE_GH_API=err assert 2 "[10] gh api blip listing workflows -> INCONCLUSIVE"

setup_good
rm -f "$WF/schedule-fired-proof.yml"
assert 2 "[11] a workflow file absent -> INCONCLUSIVE"

# ── mutation guard : prove the harness has teeth ──────────────────────────────
# Neuter check-proof-armed's ordering FAIL in a copy; the [4] same-cron config must
# then WRONGLY pass (exit 0). If it still failed, the test would be vacuous.
bold ""
bold "[12] mutation guard — a broken ordering check MUST be caught"
setup_good
sed -i.bak "s/cron: '30 13/cron: '17 13/" "$WF/schedule-fired-proof.yml"
# remove the `FAIL=1` that the same-hour ordering branch sets
sed -i.bak '/proof tick (:\$P_MIN) is not strictly after/{n;n;s/FAIL=1/FAIL=0/;}' "$SCR/check-proof-armed.sh"
mutant_exit="$(run_target)"
if [ "$mutant_exit" = "0" ]; then
  green "  PASS  neutered ordering check now passes the bad config (exit 0) — the real FAIL=1 is load-bearing"
  PASS=$((PASS+1))
else
  red   "  FAIL  mutation did not change behaviour (exit $mutant_exit) — guard [4] may be testing nothing"
  FAIL=$((FAIL+1))
fi

echo ""
bold "────────────────────────────────────────────────────────────────"
if [ "$FAIL" -eq 0 ]; then
  green "  ALL $PASS checks PASS — check-proof-armed's exit 0/1/2 logic is locked offline."
  exit 0
else
  red "  $FAIL of $((PASS+FAIL)) checks FAILED — the arming guard's exit logic has drifted."
  exit 1
fi
