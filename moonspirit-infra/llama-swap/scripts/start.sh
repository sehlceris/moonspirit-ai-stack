#!/usr/bin/env bash
set -euo pipefail

# Start the full stack: llama-swap (localhost:8080) + auth proxy (0.0.0.0:3000).
#
# Usage:
#   ./scripts/start.sh              # foreground (Ctrl+C stops both)
#   ./scripts/start.sh --bg         # background (logs to *.log files)
#   ./scripts/start.sh --port 9090  # custom llama-swap port
#   ./scripts/start.sh --proxy-port 4000

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG="$PROJECT_DIR/config.yaml"

LLAMA_PORT=8080
PROXY_PORT=3000
BACKGROUND=false
WATCH_CONFIG=true

while [[ $# -gt 0 ]]; do
    case "$1" in
        --port)        LLAMA_PORT="$2"; shift 2 ;;
        --proxy-port)  PROXY_PORT="$2"; shift 2 ;;
        --bg|--background) BACKGROUND=true; shift ;;
        --no-watch)    WATCH_CONFIG=false; shift ;;
        -h|--help)
            echo "Usage: $0 [--port PORT] [--proxy-port PORT] [--bg] [--no-watch]"
            echo ""
            echo "  --port PORT        llama-swap port (default: 8080, localhost only)"
            echo "  --proxy-port PORT  Auth proxy port (default: 3000, 0.0.0.0)"
            echo "  --bg               Run in background"
            echo "  --no-watch         Don't auto-reload config on change"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# --- Preflight ---

fail() { echo "Error: $1"; exit 1; }

command -v llama-swap &>/dev/null || fail "llama-swap not found. Install: brew tap mostlygeek/llama-swap && brew install llama-swap"
command -v llama-server &>/dev/null || fail "llama-server not found. Install: brew install llama.cpp"
command -v npx &>/dev/null || fail "npx not found. Install Node.js."
[ -f "$CONFIG" ] || fail "Config not found: $CONFIG"

cd "$PROJECT_DIR"

# --- Build commands ---

LLAMA_CMD=(llama-swap --config "$CONFIG" --listen "127.0.0.1:$LLAMA_PORT")
[ "$WATCH_CONFIG" = true ] && LLAMA_CMD+=(--watch-config)

PROXY_CMD=(npx tsx proxy.ts)

echo "==> llama-swap: http://127.0.0.1:$LLAMA_PORT (localhost only)"
echo "==> Auth proxy: http://0.0.0.0:$PROXY_PORT -> localhost:$LLAMA_PORT"
echo "==> Web UI:     http://127.0.0.1:$LLAMA_PORT/ui"
echo ""

if [ "$BACKGROUND" = true ]; then
    # Start llama-swap
    nohup "${LLAMA_CMD[@]}" > "$PROJECT_DIR/llama-swap.log" 2>&1 &
    echo $! > "$PROJECT_DIR/llama-swap.pid"
    echo "==> llama-swap PID: $(cat "$PROJECT_DIR/llama-swap.pid")"

    # Start proxy
    PROXY_PORT="$PROXY_PORT" UPSTREAM_URL="http://127.0.0.1:$LLAMA_PORT" \
        nohup "${PROXY_CMD[@]}" > "$PROJECT_DIR/proxy.log" 2>&1 &
    echo $! > "$PROJECT_DIR/proxy.pid"
    echo "==> Proxy PID:     $(cat "$PROJECT_DIR/proxy.pid")"

    echo ""
    echo "==> Logs: llama-swap.log, proxy.log"
    echo "==> Stop: ./scripts/stop.sh"
else
    echo "==> Foreground mode. Ctrl+C stops both."
    echo ""

    # Trap to kill both on Ctrl+C
    cleanup() {
        echo ""
        echo "==> Shutting down..."
        kill "$LLAMA_PID" "$PROXY_PID" 2>/dev/null || true
        wait "$LLAMA_PID" "$PROXY_PID" 2>/dev/null || true
        echo "==> Stopped."
    }
    trap cleanup EXIT INT TERM

    "${LLAMA_CMD[@]}" &
    LLAMA_PID=$!

    # Brief pause to let llama-swap bind before proxy connects
    sleep 0.5

    PROXY_PORT="$PROXY_PORT" UPSTREAM_URL="http://127.0.0.1:$LLAMA_PORT" \
        "${PROXY_CMD[@]}" &
    PROXY_PID=$!

    wait
fi
