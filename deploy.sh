#!/bin/bash
set -e

# ════════════════════════════════════════════════════════════════════════════
# Lingua Franca — One-Button Deploy
# Real-world fluency, one scene at a time
# For Even Realities G2 via EvenHub SDK
# ════════════════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$SCRIPT_DIR"

echo ""
echo "  ╔════════════════════════════════════════════════════════════════╗"
echo "  ║  Lingua Franca — Deploy Pipeline                              ║"
echo "  ║  19 languages · 103 scenarios · G2 glasses                    ║"
echo "  ╚════════════════════════════════════════════════════════════════╝"
echo ""

# ── Kill existing dev server ──
pkill -f "vite" 2>/dev/null || true
sleep 1

# ── Verify project structure ──
echo "  [1/5] Verifying project structure..."
required_files=(
  "package.json"
  "vite.config.ts"
  "tsconfig.json"
  "app.json"
  "index.html"
  "src/Main.ts"
  "src/constants.ts"
  "src/pages.ts"
  "src/events.ts"
  "src/sync.ts"
  "src/dashboard.ts"
  "src/image-utils.ts"
  "src/pngEncoder.ts"
  "src/ui.ts"
  "src/style.css"
  "src/ble-bridge.ts"
)
missing=0
for f in "${required_files[@]}"; do
  if [ ! -f "$PROJECT/$f" ]; then
    echo "        ✗ Missing: $f"
    missing=1
  fi
done
if [ $missing -eq 1 ]; then
  echo "        Some files are missing. Aborting."
  exit 1
fi
echo "        ✓ All source files present"

# ── Install dependencies ──
echo "  [2/5] Installing dependencies..."
cd "$PROJECT"
npm install
echo "        ✓ Dependencies installed"

# ── Create sprites directory ──
echo "  [3/5] Setting up assets..."
mkdir -p "$PROJECT/public/sprites"
# If logo exists on desktop, copy it
LOGO="$HOME/Desktop/lingua-franca/sprites/logo.png"
if [ -f "$LOGO" ]; then
  cp "$LOGO" "$PROJECT/public/sprites/logo.png"
  echo "        ✓ Logo copied"
else
  echo "        ⚠ No logo.png found — glasses will show blank logo area"
  echo "          Place a 200×200 PNG at: public/sprites/logo.png"
fi

# ── Type check ──
echo "  [4/5] Type checking..."
npx tsc --noEmit 2>&1 || {
  echo "        ⚠ Type errors found (non-blocking for dev)"
}
echo "        ✓ Type check complete"

# ── Start dev server ──
echo "  [5/5] Starting Vite dev server..."
npx vite --host &
DEV_PID=$!
sleep 3

echo ""
echo "  ════════════════════════════════════════════════════════════════"
echo "  ✓ Lingua Franca is running!"
echo ""
echo "  Local:   http://localhost:5173/lingua-franca/"
echo "  Network: check terminal output for network URL"
echo ""
echo "  To build for production:"
echo "    cd $PROJECT && npx vite build"
echo ""
echo "  To deploy to GitHub Pages:"
echo "    npx gh-pages -d dist"
echo ""
echo "  To pack as .ehpk for EvenHub:"
echo "    cd dist && zip -r ../lingua-franca.ehpk ."
echo "  ════════════════════════════════════════════════════════════════"
echo ""

wait $DEV_PID
