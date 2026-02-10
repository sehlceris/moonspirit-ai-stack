# Local AI Autostart (macOS)

Launches Local AI in a Terminal window on login so you can monitor output and Ctrl+C to stop.

## Install

```bash
# Create launcher script
cat > ~/apps/localai/start-localai.sh << 'EOF'
#!/bin/bash
cd /Users/chris/apps/localai
./local-ai-v3.11.0-darwin-arm64
EOF
chmod +x ~/apps/localai/start-localai.sh

# Create launch agent
mkdir -p ~/Library/LaunchAgents
cat > ~/Library/LaunchAgents/com.localai.start.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.localai.start</string>
    <key>ProgramArguments</key>
    <array>
        <string>open</string>
        <string>-a</string>
        <string>Terminal</string>
        <string>/Users/chris/apps/localai/start-localai.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
EOF
launchctl load ~/Library/LaunchAgents/com.localai.start.plist
```

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.localai.start.plist
rm ~/Library/LaunchAgents/com.localai.start.plist
rm ~/apps/localai/start-localai.sh
```

## Useful commands

```bash
launchctl start com.localai.start    # trigger it now without rebooting
launchctl unload ~/Library/LaunchAgents/com.localai.start.plist  # disable
launchctl load ~/Library/LaunchAgents/com.localai.start.plist    # re-enable
```
