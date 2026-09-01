#!/usr/bin/env bash
# ReviveAI one-time setup for macOS
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

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

warn() {
  echo -e "${YELLOW}▸${NC} $1"
}

echo ""
echo -e "${BOLD}ReviveAI — Setup${NC}"
echo "Project: $ROOT"
echo ""

# ── Homebrew ──────────────────────────────────────────────────────────────
if ! command -v brew >/dev/null 2>&1; then
  die \
    "Homebrew is not installed." \
    "Install Homebrew from https://brew.sh then re-run ./setup.sh

  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
fi
info "Homebrew found"

# ── Python 3.11+ ──────────────────────────────────────────────────────────
find_uv() {
  local u
  for u in uv "$HOME/.local/bin/uv" /opt/homebrew/bin/uv; do
    if command -v "$u" >/dev/null 2>&1 || [[ -x "$u" ]]; then
      echo "$u"
      return 0
    fi
  done
  return 1
}

UV=""
if UV="$(find_uv)"; then
  : # uv available for venv/pip fallback
fi

resolve_python() {
  local c
  for c in \
    python3.13 python3.12 python3.11 \
    /opt/homebrew/opt/python@3.13/bin/python3.13 \
    /opt/homebrew/opt/python@3.12/bin/python3.12 \
    /opt/homebrew/opt/python@3.11/bin/python3.11 \
    python3; do
    if { command -v "$c" >/dev/null 2>&1 || [[ -x "$c" ]]; } \
      && "$c" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

if ! PYTHON="$(resolve_python)"; then
  warn "Python 3.11+ not found — installing via Homebrew..."
  brew install python@3.13 || die "Failed to install Python." "brew install python@3.13"
  export PATH="/opt/homebrew/opt/python@3.13/bin:/usr/local/opt/python@3.13/bin:$PATH"
  PYTHON="$(resolve_python)" || die "Python 3.11+ is not installed." "brew install python@3.13"
fi

PY_VERSION="$("$PYTHON" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
info "Python $PY_VERSION OK ($PYTHON)"

# ── Node 18+ ──────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  warn "Node.js not found — installing via Homebrew..."
  brew install node || die "Failed to install Node.js." "brew install node"
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  warn "Node.js too old ($(node -v)) — upgrading via Homebrew..."
  brew install node || die "Failed to upgrade Node.js." "brew install node"
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
  [[ "$NODE_MAJOR" -ge 18 ]] || die "Node.js 18+ required." "brew install node"
fi
info "Node $(node -v) OK"

# ── Ollama ─────────────────────────────────────────────────────────────────
if ! command -v ollama >/dev/null 2>&1; then
  warn "Ollama not found — installing via Homebrew (may take a minute)..."
  brew install ollama || die "Failed to install Ollama." "brew install ollama"
fi
info "Ollama found"

mkdir -p "$ROOT/backend/logs"

ollama_running() {
  curl -sf --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1
}

if ollama_running; then
  info "Ollama is already running"
else
  warn "Ollama not responding — starting ollama serve in background..."
  nohup ollama serve >>"$ROOT/backend/logs/ollama.log" 2>&1 &
  OLLAMA_PID=$!
  info "Started ollama serve (PID $OLLAMA_PID, log: backend/logs/ollama.log)"

  READY=0
  for _ in $(seq 1 30); do
    if ollama_running; then
      READY=1
      break
    fi
    sleep 1
  done

  if [[ "$READY" -ne 1 ]]; then
    die \
      "Ollama did not become ready within 30 seconds." \
      "Check backend/logs/ollama.log or run: brew services start ollama"
  fi
  info "Ollama is running"
fi

# ── Pull model ─────────────────────────────────────────────────────────────
ENV_EXAMPLE="$ROOT/backend/.env.example"
if [[ ! -f "$ENV_EXAMPLE" ]]; then
  die "Missing backend/.env.example" "Re-clone the project — this file should exist."
fi

MODEL="$(grep -E '^OLLAMA_MODEL=' "$ENV_EXAMPLE" | head -1 | cut -d= -f2- | tr -d ' \"')"
if [[ -z "$MODEL" ]]; then
  MODEL="deepseek-r1:8b"
  warn "OLLAMA_MODEL not found in .env.example — defaulting to $MODEL"
fi

if ollama list 2>/dev/null | tail -n +2 | awk '{print $1}' | grep -qx "$MODEL"; then
  info "Model already pulled: $MODEL"
else
  warn "Pulling Ollama model: $MODEL (this may take several minutes)..."
  if ! ollama pull "$MODEL"; then
    die \
      "Failed to pull model '$MODEL'." \
      "Ensure Ollama is running and try: ollama pull $MODEL"
  fi
  info "Model pulled: $MODEL"
fi

# ── Python venv + deps ───────────────────────────────────────────────────────
VENV="$ROOT/backend/.venv"
VENV_OK=0

if [[ -d "$VENV" ]] && [[ -x "$VENV/bin/python" ]]; then
  VENV_OK=1
fi

if [[ "$VENV_OK" -ne 1 ]]; then
  rm -rf "$VENV"
  info "Creating Python virtualenv at backend/.venv ..."
  if "$PYTHON" -m venv "$VENV" 2>/dev/null; then
    VENV_OK=1
  else
    rm -rf "$VENV"
    warn "Standard venv failed — trying alternate bootstrap..."
    if [[ -n "$UV" ]]; then
      if "$UV" venv --python "$PYTHON" "$VENV" 2>/dev/null; then
        VENV_OK=1
      elif "$UV" venv --python 3.13 "$VENV" 2>/dev/null; then
        VENV_OK=1
      fi
    fi
    if [[ "$VENV_OK" -ne 1 ]] && "$PYTHON" -m venv --without-pip "$VENV" 2>/dev/null; then
      VENV_OK=1
    fi
  fi
  [[ "$VENV_OK" -eq 1 ]] || die \
    "Failed to create virtualenv." \
    "brew install python@3.13   OR   brew install uv"
fi

info "Installing Python dependencies..."
# shellcheck disable=SC1091
source "$VENV/bin/activate"
if python -m pip --version >/dev/null 2>&1; then
  python -m pip install --upgrade pip --quiet
  pip install -r "$ROOT/backend/requirements.txt" || die \
    "pip install failed." \
    "Check backend/requirements.txt and your network connection."
elif [[ -n "$UV" ]]; then
  warn "pip unavailable — installing via uv..."
  "$UV" pip install --python "$VENV/bin/python" -r "$ROOT/backend/requirements.txt" || die \
    "uv pip install failed." \
    "brew install python@3.13   OR   brew install uv"
else
  die \
    "Could not bootstrap pip inside the virtualenv." \
    "brew install python@3.13   OR   brew install uv"
fi
info "Python dependencies installed"

# ── .env ───────────────────────────────────────────────────────────────────
if [[ ! -f "$ROOT/backend/.env" ]]; then
  cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
  info "Created backend/.env from .env.example"
  echo ""
  echo -e "${GREEN}${BOLD}Using local Ollama — no API key needed.${NC}"
  echo "The app talks to DeepSeek-R1 on your Mac via Ollama."
  echo ""
else
  info "backend/.env already exists (left unchanged)"
fi

# ── Frontend deps ────────────────────────────────────────────────────────────
INSTALL_STAMP="$ROOT/frontend/.install-stamp"
NEED_NPM=0
if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
  NEED_NPM=1
elif [[ ! -f "$INSTALL_STAMP" ]]; then
  NEED_NPM=1
elif [[ "$ROOT/frontend/package-lock.json" -nt "$INSTALL_STAMP" ]]; then
  NEED_NPM=1
elif [[ "$ROOT/frontend/package.json" -nt "$INSTALL_STAMP" ]]; then
  NEED_NPM=1
fi

if [[ "$NEED_NPM" -eq 1 ]]; then
  info "Installing frontend dependencies (npm install)..."
  (cd "$ROOT/frontend" && npm install) || die "npm install failed." "cd frontend && npm install"
  touch "$INSTALL_STAMP"
  info "Frontend dependencies installed"
else
  info "Frontend dependencies up to date"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║  Setup complete!                                         ║${NC}"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}${BOLD}║  Next step — run the app:                                ║${NC}"
echo -e "${GREEN}${BOLD}║                                                          ║${NC}"
echo -e "${GREEN}${BOLD}║    ./start.sh                                            ║${NC}"
echo -e "${GREEN}${BOLD}║                                                          ║${NC}"
echo -e "${GREEN}${BOLD}║  Your browser will open automatically.                   ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
