#!/usr/bin/env bash
# D3 Dashboard launcher: deploy lingua-franca-api to prod + run the smoke-test gate.
# Double-clickable from Finder / the D3 Dashboard (port 7777).
cd "$(dirname "$0")"
./deploy.sh
echo ""
echo "Press any key to close…"
read -n 1 -s
