#!/usr/bin/env bash
# Create a clean zip to send to someone else (excludes local build artifacts)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="ReviveAI"
OUT="$ROOT/../${NAME}.zip"

cd "$ROOT/.."

echo "Creating ${NAME}.zip (clean — no venv, node_modules, or database)..."
zip -r "$OUT" "$(basename "$ROOT")" \
  -x "$(basename "$ROOT")/backend/.venv/*" \
  -x "$(basename "$ROOT")/backend/.venv/**" \
  -x "$(basename "$ROOT")/backend/reviveai.db" \
  -x "$(basename "$ROOT")/backend/logs/*" \
  -x "$(basename "$ROOT")/backend/.env" \
  -x "$(basename "$ROOT")/frontend/node_modules/*" \
  -x "$(basename "$ROOT")/frontend/node_modules/**" \
  -x "$(basename "$ROOT")/frontend/dist/*" \
  -x "$(basename "$ROOT")/frontend/.install-stamp" \
  -x "$(basename "$ROOT")/.DS_Store" \
  -x "$(basename "$ROOT")/**/.DS_Store" \
  -x "$(basename "$ROOT")/**/__pycache__/*" \
  -x "$(basename "$ROOT")/**/*.pyc"

echo ""
echo "Done: $OUT"
echo ""
echo "Send this file to your friend. They should:"
echo "  1. Unzip"
echo "  2. Open Terminal in the unzipped folder"
echo "  3. Run: ./setup.sh"
echo "  4. Run: ./start.sh"
