#!/bin/bash
# ============================================
# Start OpenClaw Gateway — Agent Orchestrator
# ============================================
# All agents (Duke, T-800, Hackerman, etc.) run through the gateway.
# Duke and T-800 autostart on gateway boot (see gateway/gateway.json).
#
# Usage:
#   ./start-gateway.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

if ! command -v openclaw &>/dev/null; then
    echo "[error] openclaw not found. Install: npm install -g openclaw@latest"
    exit 1
fi

PORT="${OPENCLAW_GATEWAY_PORT:-18789}"

echo "[gateway] Starting OpenClaw Gateway on port ${PORT}..."
echo "[gateway] Duke (CEO) and T-800 (Ops) will autostart."
echo "[gateway] Subagents spawned by Duke: Hackerman, Borat, Don Draper, Picasso"
echo ""

exec openclaw gateway run --port "$PORT" --force
