#!/usr/bin/env bash
set -euo pipefail

# Remove the macOS LaunchAgent for the LLM stack.

PLIST_NAME="com.moonspirit.llama-swap"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

if [ -f "$PLIST_PATH" ]; then
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    rm -f "$PLIST_PATH"
    echo "==> Removed: $PLIST_PATH"
else
    echo "==> Not installed (no plist at $PLIST_PATH)"
fi
