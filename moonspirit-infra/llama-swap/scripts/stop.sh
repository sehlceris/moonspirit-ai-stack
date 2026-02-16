#!/usr/bin/env bash
set -euo pipefail

# Stop background llama-swap and auth proxy started with start.sh --bg.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

stop_process() {
    local name="$1" pid_file="$2"
    if [ ! -f "$pid_file" ]; then
        echo "==> $name: no PID file (not running?)"
        return
    fi
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
        echo "==> Stopping $name (PID $pid)..."
        kill "$pid"
    else
        echo "==> $name (PID $pid) already stopped."
    fi
    rm -f "$pid_file"
}

stop_process "Auth proxy"  "$PROJECT_DIR/proxy.pid"
stop_process "llama-swap"  "$PROJECT_DIR/llama-swap.pid"

echo "==> Done."
