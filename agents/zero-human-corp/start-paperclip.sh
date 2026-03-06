#!/bin/bash
# ============================================
# Start Paperclip — Task Board & Control Plane
# ============================================
# Strips CLAUDECODE env var so agents can spawn claude CLI.
#
# Usage:
#   ./start-paperclip.sh          # Run with pnpm dev (embedded PGlite)
#   ./start-paperclip.sh --docker # Run via Docker

set -e

# Critical: strip CLAUDECODE so Paperclip can spawn claude CLI agents
unset CLAUDECODE

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PAPERCLIP_DIR="$(cd "$SCRIPT_DIR/../paperclip" && pwd)"

if [ "$1" = "--docker" ] || [ "$1" = "-d" ]; then
    echo "[paperclip] Starting via Docker..."
    docker compose -f "$PAPERCLIP_DIR/docker-compose.quickstart.yml" up -d
    echo "[paperclip] Running at http://localhost:3100"
else
    if [ ! -d "$PAPERCLIP_DIR" ]; then
        echo "[error] Paperclip not found at $PAPERCLIP_DIR"
        echo "  Run: git clone https://github.com/paperclipai/paperclip ../paperclip"
        exit 1
    fi

    if [ ! -d "$PAPERCLIP_DIR/node_modules" ]; then
        echo "[paperclip] Installing dependencies..."
        cd "$PAPERCLIP_DIR" && pnpm install --frozen-lockfile
    fi

    echo "[paperclip] Starting Paperclip on port 3100..."
    echo "[paperclip] UI: http://localhost:3100"
    echo ""
    cd "$PAPERCLIP_DIR" && exec pnpm dev
fi
