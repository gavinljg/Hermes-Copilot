#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

LABEL="com.edge-hermes-copilot.bridge"
PLIST_SRC="$PWD/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM="$(id -u)"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/edge-hermes-copilot"
cp "$PLIST_SRC" "$PLIST_DST"

launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST_DST"
launchctl enable "gui/$UID_NUM/$LABEL"
launchctl kickstart -k "gui/$UID_NUM/$LABEL"

echo "Installed and started $LABEL"
launchctl print "gui/$UID_NUM/$LABEL" | sed -n '1,80p'
