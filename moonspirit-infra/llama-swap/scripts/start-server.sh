#!/usr/bin/env bash
set -euo pipefail

# Start llama-swap, which manages llama-server instances automatically.
#
# Usage:
#   ./scripts/start-server.sh              # foreground (default, port 8080)
#   ./scripts/start-server.sh --port 9090  # custom port
#   ./scripts/start-server.sh --bg         # run in background, log to file
#
# llama-swap listens on the given port and exposes an OpenAI-compatible API.
# Models are loaded on first request and stay in memory (ttl: 0 in config).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG="$PROJECT_DIR/config.yaml"
LOG_FILE="$PROJECT_DIR/llama-swap.log"

PORT=8080
BACKGROUND=false
WATCH_CONFIG=true

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --port)
            PORT="$2"
            shift 2
            ;;
        --bg|--background)
            BACKGROUND=true
            shift
            ;;
        --no-watch)
            WATCH_CONFIG=false
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--port PORT] [--bg] [--no-watch]"
            echo ""
            echo "  --port PORT    Listen port (default: 8080)"
            echo "  --bg           Run in background, log to $LOG_FILE"
            echo "  --no-watch     Don't auto-reload config on change"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Preflight checks
if ! command -v llama-swap &>/dev/null; then
    echo "Error: llama-swap not found. Install with: brew tap mostlygeek/llama-swap && brew install llama-swap"
    exit 1
fi

if ! command -v llama-server &>/dev/null; then
    echo "Error: llama-server not found. Install with: brew install llama.cpp"
    exit 1
fi

if [ ! -f "$CONFIG" ]; then
    echo "Error: Config not found at $CONFIG"
    exit 1
fi

# Build command
CMD=(llama-swap --config "$CONFIG" --listen "127.0.0.1:$PORT")

if [ "$WATCH_CONFIG" = true ]; then
    CMD+=(--watch-config)
fi

echo "==> Starting llama-swap on http://127.0.0.1:$PORT"
echo "==> Config: $CONFIG"
echo "==> Watch config: $WATCH_CONFIG"
echo "==> Web UI: http://127.0.0.1:$PORT/ui"
echo ""

# Change to project directory so relative model paths in config.yaml resolve correctly.
cd "$PROJECT_DIR"

if [ "$BACKGROUND" = true ]; then
    echo "==> Running in background. Logs: $LOG_FILE"
    echo "==> To stop: kill \$(cat $PROJECT_DIR/llama-swap.pid)"
    nohup "${CMD[@]}" > "$LOG_FILE" 2>&1 &
    echo $! > "$PROJECT_DIR/llama-swap.pid"
    echo "==> PID: $(cat "$PROJECT_DIR/llama-swap.pid")"
else
    echo "==> Running in foreground. Press Ctrl+C to stop."
    echo ""
    exec "${CMD[@]}"
fi
