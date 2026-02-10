#!/usr/bin/env bash
set -euo pipefail

# Stop a background llama-swap instance started with start-server.sh --bg.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$PROJECT_DIR/llama-swap.pid"

if [ ! -f "$PID_FILE" ]; then
    echo "No PID file found at $PID_FILE — is the server running in background mode?"
    exit 1
fi

PID="$(cat "$PID_FILE")"

if kill -0 "$PID" 2>/dev/null; then
    echo "==> Stopping llama-swap (PID $PID)..."
    kill "$PID"
    rm -f "$PID_FILE"
    echo "==> Stopped."
else
    echo "==> Process $PID is not running. Cleaning up stale PID file."
    rm -f "$PID_FILE"
fi
