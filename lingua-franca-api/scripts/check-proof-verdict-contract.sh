#!/usr/bin/env bash
# Cross-script CONTRACT test: assert the verdict strings check-schedule-fired.sh
# actually EMITS are matched by the grep patterns capture-cron-proof.sh uses to
# read them. Locks the producer↔consumer handshake the locked cron-proof mission
# rides on, so an edit to EITHER side cannot silently break the unattended capture.
#
# WHY THIS EXISTS (the gap it closes):
#   schedule-fired-proof.yml runs check-schedule-fired.sh (the PRODUCER) on its cron;
#   capture-cron-proof.sh (the CONSUMER) then reads that run's log and decides whether
#   the genuine N-job exit-0 proof was captured. The consumer recognises the proof by
#   grepping the producer's stdout for three things:
#     1. the exit-0 verdict   ~  /PASS +.*fired UNATTENDED/
#     2. the neutral verdict   ~ /PENDING +the cron fired green, but/
#     3. the judged audit id   ~ first /run +#[0-9]+/  (must be the audit RUN_ID)
#   capture-cron-proof.selftest.sh proves the consumer's exit codes — but it feeds
#   HAND-COPIED fixture strings (LOG_PASS=…, LOG_PENDING=…) that merely MIRROR the
#   producer. If someone reworded the producer's PASS line to drop "UNATTENDED", or
#   reordered its output so a different "run #" prints first, the selftest would still
#   pass on its stale copy while the REAL capture broke — exit-2 forever, mission
#   silently un-closable. This test removes the mirror: it sources the producer's
#   REAL string templates and the consumer's REAL regexes from disk and checks they
#   still agree. (Same anti-drift principle as check-alias-guard.sh sourcing the live
#   YAML step body instead of a copy.)
#
# HOW IT WORKS:
#   - Consumer regexes are extracted live from the `grep -E`/`grep -qE`/`grep -oE`
#     lines of capture-cron-proof.sh (no regex is hard-coded here).
#   - Producer strings are extracted live from check-schedule-fired.sh's PASS/PENDING/
#     run-echo lines and RENDERED by eval-ing the real quoted literal with sample
#     variable values — i.e. exactly the bytes the producer would print at a tick.
#   - Each rendered producer line is asserted to satisfy its consumer regex, and the
#     producer transcript's FIRST `run +#` is asserted to be the audit RUN_ID.
#   - Mutation guards prove the assertions have teeth: a producer line with the
#     contract phrase removed MUST fail its consumer regex.
#
# Usage:   ./scripts/check-proof-verdict-contract.sh   (no network, no gh, offline)
# Exit:    0 = producer emits exactly what consumer greps for (+ mutations caught)
#          1 = a contract MISMATCH or a mutation slipped through (drift)
#          2 = prerequisite missing (a script not found / a pattern not extractable)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD="$SCRIPT_DIR/check-schedule-fired.sh"     # producer: emits the verdict strings
CONS="$SCRIPT_DIR/capture-cron-proof.sh"       # consumer: greps them back out
PASS=0; FAIL=0

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

for f in "$PROD" "$CONS"; do
  [ -f "$f" ] || { yellow "  SKIP  cannot find $f — run from a lingua-franca clone."; exit 2; }
done

# ── consumer regexes, extracted LIVE from capture-cron-proof.sh ───────────────
# Pull the regex literal out of each `grep -*E '<re>'` line by content keyword, so
# the test tracks the consumer's real patterns rather than copies of them.
extract_re() { # extract_re <keyword that uniquely identifies the grep pattern>
  # Pull EVERY `grep -*E '<re>'` occurrence (one per match, even two on one line —
  # line 138 has both `run +#[0-9]+` and `[0-9]+`), unwrap each, then keep the
  # pattern that actually contains the keyword. A greedy strip would grab the last.
  grep -oE "grep -[a-zA-Z]*E '[^']*'" "$CONS" \
    | sed -E "s/grep -[a-zA-Z]*E '//; s/'$//" \
    | grep -F "$1" | head -1
}
# Key extraction on each pattern's STABLE verdict-type prefix (PASS/PENDING/run),
# NOT on its descriptive phrase — so rewording the phrase on the consumer side is
# caught as a real regex↔string mismatch instead of silently dropping the pattern.
PASS_RE="$(extract_re 'PASS ')"
PEND_RE="$(extract_re 'PENDING ')"
RUNID_RE="$(extract_re 'run ')"

[ -n "$PASS_RE" ]  || { yellow "  SKIP  could not extract the PASS regex from $CONS."; exit 2; }
[ -n "$PEND_RE" ]  || { yellow "  SKIP  could not extract the PENDING regex from $CONS."; exit 2; }
[ -n "$RUNID_RE" ] || { yellow "  SKIP  could not extract the run-id regex from $CONS."; exit 2; }

# ── producer strings, RENDERED from check-schedule-fired.sh's real literals ───
# Sample values the producer would hold at a genuine exit-0 tick.
WORKFLOW=branch-protection-audit.yml; BRANCH=main; RUN_ID=28243876236
STATUS=completed; CONCL=success; CREATED=2026-06-27T13:17:02Z; ADDED_AFTER=1
# Extract the first double-quoted literal from the producer line carrying <keyword>,
# then eval it with the vars above set => the exact bytes that line would print.
render() { # render <keyword identifying the producer line>
  local lit
  lit="$(grep -F "$1" "$PROD" | grep -oE '"[^"]*"' | head -1)"
  [ -n "$lit" ] || return 1
  eval "printf '%s' $lit"
}
# Anchor render() on STABLE tails of each producer line — NOT the contract phrase
# itself — so that dropping/rewording the contract phrase still locates the line and
# surfaces as a clean FAIL (exit 1), not a can't-find SKIP (exit 2).
PASS_STR="$(render 'every required job is green')" || { yellow "  SKIP  producer PASS line not found."; exit 2; }
PEND_STR="$(render 'expected job(s) were added')"  || { yellow "  SKIP  producer PENDING line not found."; exit 2; }
RUN_STR="$(render 'run     #')"                     || { yellow "  SKIP  producer run-echo line not found."; exit 2; }

assert_match() { # assert_match <label> <text> <regex> <want: yes|no>
  if printf '%s' "$2" | grep -qE "$3"; then got=yes; else got=no; fi
  if [ "$got" = "$4" ]; then green "  PASS  $1"; PASS=$((PASS+1))
  else red "  FAIL  $1 (regex '$3' ${4}-match expected, got $got) on: $2"; FAIL=$((FAIL+1)); fi
}

bold "== check-proof-verdict-contract :: producer strings ⇆ consumer greps =="
echo  "  producer: $(basename "$PROD")   consumer: $(basename "$CONS")"
echo  "  PASS_RE='$PASS_RE'  PEND_RE='$PEND_RE'  RUNID_RE='$RUNID_RE'"
echo ""

# 1. The genuine exit-0 verdict the producer prints satisfies the consumer's PASS grep.
assert_match "producer PASS verdict matches consumer PASS regex"            "$PASS_STR" "$PASS_RE" yes
# 2. The neutral/PENDING verdict the producer prints satisfies the consumer's PENDING grep.
assert_match "producer PENDING verdict matches consumer PENDING regex"      "$PEND_STR" "$PEND_RE" yes
# 3. The producer's run-echo line yields an audit run id under the consumer's id regex.
assert_match "producer run-echo line matches consumer run-id regex"         "$RUN_STR"  "$RUNID_RE" yes

# 4. First `run +#` in a representative producer transcript == the judged audit RUN_ID.
#    (The consumer does `... | head -1` — the FIRST run id must be the audit run, not
#    some later id, or step 3 of the capturer reads the wrong run's jobs.)
TRANSCRIPT="$(printf '%s\n%s\n' "$RUN_STR" "$PASS_STR")"   # run-echo prints before the PASS line
FIRST_ID="$(printf '%s' "$TRANSCRIPT" | grep -oE "$RUNID_RE" | head -1 | grep -oE '[0-9]+')"
if [ "$FIRST_ID" = "$RUN_ID" ]; then green "  PASS  first run-id in producer transcript is the judged audit run ($FIRST_ID)"; PASS=$((PASS+1))
else red "  FAIL  first run-id extracted is '$FIRST_ID', not the audit RUN_ID '$RUN_ID' — capturer would read the wrong run"; FAIL=$((FAIL+1)); fi

# ── mutation guards: prove the contract assertions have teeth ─────────────────
echo ""
bold "  -- mutation guards (a broken producer line MUST fail its consumer regex) --"
# 5. Drop "UNATTENDED" from the PASS verdict -> consumer PASS grep must MISS it.
assert_match "mutated PASS (no 'UNATTENDED') is correctly rejected" \
  "${PASS_STR/UNATTENDED/ATTENDED-BY-HAND}" "$PASS_RE" no
# 6. Reword the PENDING phrase -> consumer PENDING grep must MISS it.
assert_match "mutated PENDING (reworded phrase) is correctly rejected" \
  "${PEND_STR/the cron fired green, but/the cron is green however}" "$PEND_RE" no

echo ""
if [ "$FAIL" -gt 0 ]; then
  red "  $FAIL/$((PASS+FAIL)) contract checks FAILED — the producer↔consumer verdict handshake drifted."
  red "  Re-align the grep in $(basename "$CONS") with the verdict string in $(basename "$PROD")."
  exit 1
fi
green "  ALL $PASS contract checks PASS — capture-cron-proof.sh reads exactly what check-schedule-fired.sh writes."
exit 0
