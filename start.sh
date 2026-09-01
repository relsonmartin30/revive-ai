#!/usr/bin/env bash
# ReviveAI — start backend + frontend (macOS)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BACKEND_PORT=8000
FRONTEND_PORT=5174
FRONTEND_URL="http://localhost:${FRONTEND_PORT}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

BACKEND_PID=""
CLEANED=0

die() {
  echo ""
  echo -e "${RED}${BOLD}ERROR:${NC} $1" >&2
  if [[ -n "${2:-}" ]]; then
    echo -e "${YELLOW}Fix:${NC} $2" >&2
  fi
  echo "" >&2
  exit 1
}

info() {
  echo -e "${GREEN}▸${NC} $1"
}

cleanup() {
  if [[ "$CLEANED" -eq 1 ]]; then return; fi
  CLEANED=1
  echo ""
  info "Shutting down..."
  if [[ -n "$BACKEND_PID" ]]; then
    pkill -P "$BACKEND_PID" 2>/dev/null || true
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
    # uvicorn --reload leaves a worker child; ensure port is freed
    pkill -f "uvicorn main:app.*--port ${BACKEND_PORT}" 2>/dev/null || true
    info "Backend stopped"
  fi
}

trap cleanup EXIT INT TERM
echo -e "${BOLD}ReviveAI — Starting${NC}"
echo ""

# ── Prerequisites ────────────────────────────────────────────────────────────
[[ -d "$ROOT/backend/.venv" ]] || die "Backend not set up." "Run ./setup.sh first"
[[ -d "$ROOT/frontend/node_modules" ]] || die "Frontend not set up." "Run ./setup.sh first"
[[ -f "$ROOT/backend/.env" ]] || die "Missing backend/.env" "Run ./setup.sh first"

mkdir -p "$ROOT/backend/logs"

# ── Ollama ───────────────────────────────────────────────────────────────────
if ! command -v ollama >/dev/null 2>&1; then
  die "Ollama is not installed." "brew install ollama  (or run ./setup.sh)"
fi

ollama_running() {
  curl -sf --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1
}

if ollama_running; then
  info "Ollama is running"
else
  info "Starting Ollama..."
  nohup ollama serve >>"$ROOT/backend/logs/ollama.log" 2>&1 &
  for _ in $(seq 1 30); do
    if ollama_running; then break; fi
    sleep 1
  done
  ollama_running || die "Ollama failed to start." "brew services start ollama"
  info "Ollama is running"
fi

# ── Backend ──────────────────────────────────────────────────────────────────
VENV_PY="$ROOT/backend/.venv/bin/python"
[[ -x "$VENV_PY" ]] || die "Broken Python venv." "Run ./setup.sh again (needed after moving/renaming the folder)"
info "Starting backend on port $BACKEND_PORT (log: backend/logs/server.log)..."
cd "$ROOT/backend"
nohup "$VENV_PY" -m uvicorn main:app --reload --host 127.0.0.1 --port "$BACKEND_PORT" \
  >>"$ROOT/backend/logs/server.log" 2>&1 &
BACKEND_PID=$!
cd "$ROOT"

info "Waiting for backend (up to 15s)..."
BACKEND_UP=0
for _ in $(seq 1 15); do
  if curl -sf --max-time 2 "http://127.0.0.1:${BACKEND_PORT}/api/ai-health" >/dev/null 2>&1; then
    BACKEND_UP=1
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    die \
      "Backend process exited unexpectedly." \
      "Check backend/logs/server.log for details."
  fi
  sleep 1
done

if [[ "$BACKEND_UP" -ne 1 ]]; then
  die \
    "Backend did not respond on http://127.0.0.1:${BACKEND_PORT} within 15 seconds." \
    "Check backend/logs/server.log — common fix: run ./setup.sh again"
fi
info "Backend is ready (PID $BACKEND_PID)"

# ── Open browser after frontend starts ───────────────────────────────────────
(
  sleep 4
  if command -v open >/dev/null 2>&1; then
    open "$FRONTEND_URL" 2>/dev/null || true
  fi
) &

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║  ReviveAI is starting!                                   ║${NC}"
echo -e "${GREEN}${BOLD}║                                                          ║${NC}"
echo -e "${GREEN}${BOLD}║  Open in browser:  ${FRONTEND_URL}              ║${NC}"
echo -e "${GREEN}${BOLD}║  Backend API:      http://127.0.0.1:${BACKEND_PORT}                 ║${NC}"
echo -e "${GREEN}${BOLD}║                                                          ║${NC}"
echo -e "${GREEN}${BOLD}║  Browser opens automatically in a few seconds.           ║${NC}"
echo -e "${GREEN}${BOLD}║  Press Ctrl+C here to stop everything.                   ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
info "Starting frontend (foreground — Ctrl+C stops both)..."
echo ""

# Disable trap exit on normal npm exit — cleanup still runs
cd "$ROOT/frontend"
npm run dev
