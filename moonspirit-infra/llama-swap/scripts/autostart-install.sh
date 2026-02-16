#!/usr/bin/env bash
set -euo pipefail

# Install a macOS LaunchAgent that opens the LLM stack in a Terminal window on login.
# Ctrl+C in that Terminal window stops both services.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
START_SCRIPT="$SCRIPT_DIR/start.sh"
PLIST_NAME="com.moonspirit.llama-swap"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

if [ ! -x "$START_SCRIPT" ]; then
    echo "Error: $START_SCRIPT not found or not executable"
    exit 1
fi

mkdir -p ~/Library/LaunchAgents

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>open</string>
        <string>-a</string>
        <string>Terminal</string>
        <string>$START_SCRIPT</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
EOF

launchctl load "$PLIST_PATH"

echo "==> Installed: $PLIST_PATH"
echo "==> The LLM stack will start in a Terminal window on login."
echo "==> To start now:   launchctl start $PLIST_NAME"
echo "==> To uninstall:   ./scripts/autostart-uninstall.sh"
