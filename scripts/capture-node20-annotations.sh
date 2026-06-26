#!/usr/bin/env bash
# capture-node20-annotations.sh — dumps every check-run annotation for a GitHub
# Actions run, then reports whether any "Node.js 20 is deprecated" warning fired.
# This is the repeatable before/after proof method for actions/checkout vN bumps
# (same technique used for sommNI PR #1). Exit 0 = no Node-20 warning (clean),
# exit 1 = Node-20 warning present (pre-bump baseline). Usage:
#   scripts/capture-node20-annotations.sh <run_id> [owner/repo]
set -euo pipefail

RUN_ID="${1:?usage: capture-node20-annotations.sh <run_id> [owner/repo]}"
REPO="${2:-d3hospitality/lingua-franca}"

echo "== run $RUN_ID ($REPO) =="
jobs=$(gh api "repos/$REPO/actions/runs/$RUN_ID/jobs" --jq '.jobs[].id')

annotations=""
for cr in $jobs; do
  out=$(gh api "repos/$REPO/check-runs/$cr/annotations" \
    --jq '.[] | "\(.annotation_level): \(.message)"' 2>/dev/null || true)
  [ -n "$out" ] && annotations+="$out"$'\n'
done

if [ -z "${annotations//[$'\n']/}" ]; then
  echo "(no annotations)"
else
  printf '%s' "$annotations" | sort -u
fi

if printf '%s' "$annotations" | grep -qi "Node.js 20 is deprecated"; then
  echo ">> NODE-20 WARNING PRESENT (pre-bump baseline)"
  exit 1
fi
echo ">> clean — no Node-20 deprecation warning"
exit 0
