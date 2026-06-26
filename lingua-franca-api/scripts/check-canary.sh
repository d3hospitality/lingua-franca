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
#          1 = stale / red / never-fired (canary needs attention)
#          2 = prerequisite failure (gh missing, not authed, workflow not found)
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
  echo "  The cron (17 13 * * *) has not fired on its own, or the schedule trigger"
  echo "  is not registered on the default branch. Until the next 13:17 UTC tick"
  echo "  produces a run here, the idle-prod regression guard is UNPROVEN."
  exit 1
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
