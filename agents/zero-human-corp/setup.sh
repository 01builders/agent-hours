#!/bin/bash
# ============================================
# Zero Human Corp — Setup
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PAPERCLIP_DIR="$(cd "$SCRIPT_DIR/../paperclip" 2>/dev/null && pwd || echo "")"

echo "Zero Human Corp — Setup"
echo ""

# --- Prerequisites ---
check_cmd() {
    if command -v "$1" &>/dev/null; then
        echo "  ok  $1"
        return 0
    else
        echo "  missing  $1 — $2"
        return 1
    fi
}

echo "Prerequisites:"
MISSING=0
check_cmd "node" "Install Node.js 20+ from https://nodejs.org" || MISSING=1
check_cmd "pnpm" "Run: corepack enable" || MISSING=1
check_cmd "python3" "Install Python 3.10+" || MISSING=1
check_cmd "claude" "Install Claude Code CLI (requires Claude Max)" || MISSING=1
check_cmd "wrangler" "Install: npm install -g wrangler" || true

if [ "$MISSING" -eq 1 ]; then
    echo ""
    echo "Install missing tools, then re-run."
    exit 1
fi

# --- Paperclip ---
echo ""
echo "Paperclip:"
if [ -d "$PAPERCLIP_DIR" ]; then
    echo "  ok  paperclip repo at $PAPERCLIP_DIR"
    if [ ! -d "$PAPERCLIP_DIR/node_modules" ]; then
        echo "  Installing Paperclip dependencies..."
        cd "$PAPERCLIP_DIR" && pnpm install --frozen-lockfile
        echo "  ok  dependencies installed"
    else
        echo "  ok  dependencies already installed"
    fi
else
    echo "  missing  Cloning Paperclip..."
    cd "$(dirname "$SCRIPT_DIR")" && git clone https://github.com/paperclipai/paperclip paperclip
    cd paperclip && pnpm install --frozen-lockfile
    echo "  ok  Paperclip cloned and installed"
fi

# --- .env ---
echo ""
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    echo "Created .env from template."
else
    echo ".env already exists."
fi

# --- Python dependencies ---
echo ""
echo "Python:"
pip3 install --quiet --break-system-packages schedule 2>/dev/null \
  || pip3 install --quiet schedule 2>/dev/null \
  || true
echo "  ok  dependencies installed"

# --- Done ---
echo ""
echo "Setup complete."
echo ""
echo "To start:"
echo "  Terminal 1:  cd ../paperclip && pnpm dev    # http://localhost:3100"
echo "  Terminal 2:  node bootstrap.js              # provision ZHC (one-time)"
echo ""
echo "Then wake Duke in the Paperclip UI at http://localhost:3100"
