#!/usr/bin/env bash
# Canary watchdog: confirms the DAILY SCHEDULED smoke-prod canary actually fired on
# its own and landed green. smoke-prod-live.yml runs `cron: 17 13 * * *` (13:17 UTC)
# to catch idle-prod regressions — expired API keys, upstream Whisper/Deepgram
# outages, Vercel timeouts — that occur BETWEEN deploys (no push/dispatch to trigger
# the live gate). But a cron you never check is a cron you can't trust: GitHub
# silently disables scheduled workflows after 60 days of repo inactivity, the
# scheduler can skip fires under load, and a schedule only evaluates on the DEFAULT
# branch. This script closes that loop: it queries the Actions API for the most
# recent `schedule`-event run and asserts it is both RECENT and GREEN.
#
# Usage:   ./scripts/check-canary.sh [--max-age-hours N] [--repo OWNER/NAME]
#          --max-age-hours N   staleness threshold (default 26: 24h cron + scheduler
#                              slack; GitHub may delay a scheduled run by up to ~1h)
#          --repo OWNER/NAME   target repo (default d3hospitality/lingua-franca)
# Exit:    0 = a green schedule run landed within the window (canary is alive)
#          1 = stale / red / cron disabled / trigger missing (canary needs attention)
#          2 = prerequisite failure (gh missing, not authed, workflow not found)
#          3 = BENIGN PENDING — the schedule is registered & active but its first tick
#              is not yet due (e.g. the workflow was (re)registered AFTER the most
#              recent cron time), or a just-due tick is still inside GitHub's scheduler
#              delay grace. Nothing is broken; re-check after the next tick. This is the
#              key distinction the old flat "exit 1 on no run" could not make — a freshly
#              registered cron must not be reported as a fault before it has had a chance
#              to fire, or the swarm chases a non-problem (re-enabling a healthy cron).
# Requires: gh (authenticated), python3 (for ISO-8601 age math, no GNU date needed).

set -uo pipefail

REPO="d3hospitality/lingua-franca"
WORKFLOW="smoke-prod-live.yml"
MAX_AGE_HOURS=26

while [ $# -gt 0 ]; do
  case "$1" in
    --max-age-hours) MAX_AGE_HOURS="$2"; shift 2 ;;
    --repo)          REPO="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

command -v gh >/dev/null 2>&1 || { red "gh CLI not found — install it to run the canary watchdog"; exit 2; }
gh auth status >/dev/null 2>&1 || { red "gh is not authenticated — run 'gh auth login'"; exit 2; }
command -v python3 >/dev/null 2>&1 || { red "python3 not found — needed for age math"; exit 2; }

bold "== canary watchdog :: did the daily scheduled smoke-prod fire green? =="
echo "repo=$REPO  workflow=$WORKFLOW  max-age=${MAX_AGE_HOURS}h"
echo ""

# Most recent SCHEDULE-event run only — push/dispatch/manual runs prove the gate works
# but NOT that the unattended cron path fires; that is the exact thing this guards.
RUN_JSON="$(gh run list --repo "$REPO" --workflow "$WORKFLOW" --event schedule \
  --limit 1 --json databaseId,status,conclusion,createdAt,url 2>/dev/null)"

if [ -z "$RUN_JSON" ] || [ "$RUN_JSON" = "[]" ]; then
  red "  NO scheduled run found yet for $WORKFLOW."
  echo ""
  echo "  Diagnosing: is this BENIGN (cron registered, first tick not yet due) or a"
  echo "  REAL fault (schedule trigger missing / cron auto-disabled)?"
  echo ""

  # (a) Is the workflow registered at all, and is it active? GitHub keeps a workflow's
  #     record but flips state to disabled_inactivity after 60 days of repo silence; a
  #     disabled cron will never fire and IS a real fault to re-enable.
  WF_META="$(gh api "repos/$REPO/actions/workflows" \
    --jq ".workflows[] | select(.path==\".github/workflows/$WORKFLOW\") | {state,created_at}" 2>/dev/null)"
  if [ -z "$WF_META" ]; then
    red "  Workflow $WORKFLOW is NOT registered on $REPO (no matching workflow record)."
    echo "  A schedule only evaluates on the DEFAULT branch — push the file there to register it."
    exit 1
  fi
  WF_STATE="$(printf '%s' "$WF_META"   | python3 -c 'import sys,json;print(json.load(sys.stdin)["state"])')"
  WF_CREATED="$(printf '%s' "$WF_META" | python3 -c 'import sys,json;print(json.load(sys.stdin)["created_at"])')"
  if [ "$WF_STATE" != "active" ]; then
    red "  Workflow state=$WF_STATE — the cron is DISABLED and will never fire."
    echo "  GitHub auto-disables schedules after 60 days of repo inactivity. Re-enable with:"
    echo "    gh workflow enable $WORKFLOW --repo $REPO   (or the Actions tab)"
    exit 1
  fi

  # (b) Is the schedule trigger actually PRESENT on the default branch? The file as
  #     GitHub sees it is authoritative — a local edit that wasn't pushed wouldn't fire.
  DEF_BRANCH="$(gh repo view "$REPO" --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null)"
  WF_RAW="$(gh api "repos/$REPO/contents/.github/workflows/$WORKFLOW?ref=$DEF_BRANCH" \
    -H "Accept: application/vnd.github.raw" 2>/dev/null)"
  CRON="$(printf '%s' "$WF_RAW" | grep -oE "cron:[[:space:]]*['\"][^'\"]+['\"]" | head -1 \
    | sed -E "s/.*['\"]([^'\"]+)['\"].*/\1/")"
  if [ -z "$CRON" ]; then
    red "  No 'schedule.cron' trigger found in $WORKFLOW on $DEF_BRANCH."
    echo "  The daily canary cannot fire without a schedule trigger on the default branch."
    exit 1
  fi
  echo "  schedule registered: cron='$CRON'  state=$WF_STATE  workflow-created=$WF_CREATED"

  # (c) Has a cron tick been DUE since GitHub registered this workflow? If the most
  #     recent tick predates registration, no scheduled run could possibly exist yet —
  #     that is BENIGN PENDING, not a fault. Daily crons ('M H * * *') are computed
  #     exactly; non-daily forms fall back to "registered, assume pending" conservatively.
  #     A grace window (SLACK below) absorbs GitHub's scheduler delay of up to ~1h.
  SLACK_HOURS="$(python3 -c "print(max(1.5, float('$MAX_AGE_HOURS') - 24))")"
  VERDICT="$(python3 - "$CRON" "$WF_CREATED" "$SLACK_HOURS" <<'PY'
import sys, datetime
cron, created_s, slack = sys.argv[1].split(), sys.argv[2], float(sys.argv[3])
created = datetime.datetime.fromisoformat(created_s.replace("Z", "+00:00")).astimezone(datetime.timezone.utc)
now = datetime.datetime.now(datetime.timezone.utc)
# Only the simple daily form 'M H * * *' is computed exactly; anything else -> PENDING.
if len(cron) == 5 and cron[2:] == ["*", "*", "*"] and cron[0].isdigit() and cron[1].isdigit():
    today = now.replace(hour=int(cron[1]), minute=int(cron[0]), second=0, microsecond=0)
    last_tick = today if today <= now else today - datetime.timedelta(days=1)
    next_tick = today if today > now else today + datetime.timedelta(days=1)
    if last_tick < created:
        print(f"PENDING_REG|{next_tick.isoformat()}")              # first tick not yet due
    elif (now - last_tick).total_seconds() / 3600 <= slack:
        print(f"PENDING_DELAY|{last_tick.isoformat()}|{next_tick.isoformat()}")  # due, within grace
    else:
        print(f"STALE|{last_tick.isoformat()}")                    # due long ago, never ran
else:
    print("PENDING_UNKNOWN|non-daily cron — cannot compute exact tick; assuming pending")
PY
)"
  KIND="${VERDICT%%|*}"; REST="${VERDICT#*|}"
  echo ""
  case "$KIND" in
    PENDING_REG)
      green "  PENDING (benign): the cron was registered AFTER the most recent tick, so no"
      echo  "  scheduled run could exist yet. Nothing is broken — the guard simply has not"
      echo  "  had its first unattended fire. Next tick: $REST"
      echo  "  Re-run this watchdog after that time to flip the mission to CONFIRMED."
      exit 3 ;;
    PENDING_DELAY)
      DUE="${REST%%|*}"; NXT="${REST#*|}"
      green "  PENDING (benign): a tick was due at $DUE but is still inside GitHub's scheduler"
      echo  "  delay grace (~1h). The run may appear shortly. Next tick: $NXT"
      echo  "  Re-run this watchdog in a bit; only escalate if it stays empty past the grace."
      exit 3 ;;
    PENDING_UNKNOWN)
      green "  PENDING (benign): $REST"
      exit 3 ;;
    *)
      red "  STALE: a tick was due at $REST but produced NO run — the cron is not firing."
      echo "  Cron is registered & active yet not executing: GitHub may have skipped fires"
      echo "  under load, or the schedule was paused. Re-run the watchdog; if it stays empty,"
      echo "  re-enable via 'gh workflow enable $WORKFLOW --repo $REPO' or push a fresh commit."
      exit 1 ;;
  esac
fi

ID="$(printf '%s' "$RUN_JSON"      | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["databaseId"])')"
STATUS="$(printf '%s' "$RUN_JSON"  | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["status"])')"
CONCL="$(printf '%s' "$RUN_JSON"   | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["conclusion"] or "")')"
CREATED="$(printf '%s' "$RUN_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["createdAt"])')"
URL="$(printf '%s' "$RUN_JSON"     | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["url"])')"

# Age of the most recent scheduled run, in hours, computed in UTC. python3 avoids the
# GNU-vs-BSD `date -d` portability trap (this runs on macOS hosts and Linux CI alike).
AGE_HOURS="$(python3 - "$CREATED" <<'PY'
import sys, datetime
created = datetime.datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00"))
now = datetime.datetime.now(datetime.timezone.utc)
print(f"{(now - created).total_seconds() / 3600:.1f}")
PY
)"

echo "  latest scheduled run: #$ID  status=$STATUS  conclusion=${CONCL:-<in-progress>}  age=${AGE_HOURS}h"
echo "  $URL"
echo ""

RC=0

# 1. Freshness — a scheduled run must have appeared inside the window. A stale newest
#    run means the cron stopped firing (disabled by inactivity, or skipped fires).
STALE="$(python3 -c "print(1 if float('$AGE_HOURS') > float('$MAX_AGE_HOURS') else 0)")"
if [ "$STALE" = "1" ]; then
  red "  STALE  newest scheduled run is ${AGE_HOURS}h old (> ${MAX_AGE_HOURS}h)."
  echo "         The cron likely stopped firing — GitHub auto-disables schedules after"
  echo "         60 days of repo inactivity. Re-enable via the Actions tab or push a commit."
  RC=1
else
  green "  FRESH  scheduled run fired ${AGE_HOURS}h ago — the cron is alive."
fi

# 2. Outcome — a fresh-but-RED canary is the actual regression signal we built this for.
if [ "$STATUS" != "completed" ]; then
  echo "  PENDING  run still $STATUS — re-check once it completes."
elif [ "$CONCL" = "success" ]; then
  green "  GREEN  scheduled canary passed — idle prod is healthy."
else
  red "  RED  scheduled canary conclusion=$CONCL — PROD REGRESSION between deploys."
  echo "       Inspect the run: $URL  (expired keys? upstream outage? function timeout?)"
  RC=1
fi

echo ""
if [ "$RC" -eq 0 ]; then
  green "== canary confirmed: scheduled cron fired on its own AND landed green =="
else
  red   "== canary NOT confirmed — see above =="
fi
exit $RC
