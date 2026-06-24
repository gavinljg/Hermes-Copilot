#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${HERMES_COPILOT_REPO_URL:-https://github.com/gavinljg/Hermes-Copilot.git}"
INSTALL_DIR="${HERMES_COPILOT_INSTALL_DIR:-$HOME/.local/share/hermes-copilot}"
LABEL="com.edge-hermes-copilot.bridge"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM="$(id -u)"

info() {
  printf '[Hermes Copilot] %s\n' "$*"
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    return 1
  fi
}

need_cmd git
need_cmd node

if ! command -v hermes >/dev/null 2>&1; then
  cat >&2 <<'MSG'
Hermes command was not found.

Please install and configure Hermes first, then rerun this installer.
MSG
  exit 1
fi

mkdir -p "$(dirname "$INSTALL_DIR")" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/edge-hermes-copilot"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Updating $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only
else
  rm -rf "$INSTALL_DIR"
  info "Cloning $REPO_URL to $INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

NODE_BIN="$(command -v node)"
cp "$INSTALL_DIR/com.edge-hermes-copilot.bridge.plist" "$PLIST_DST"
/usr/libexec/PlistBuddy -c "Set :ProgramArguments:0 $NODE_BIN" "$PLIST_DST"
/usr/libexec/PlistBuddy -c "Set :ProgramArguments:1 $INSTALL_DIR/bridge/server.js" "$PLIST_DST"
/usr/libexec/PlistBuddy -c "Set :WorkingDirectory $INSTALL_DIR" "$PLIST_DST"

launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST_DST"
launchctl enable "gui/$UID_NUM/$LABEL"
launchctl kickstart -k "gui/$UID_NUM/$LABEL"

sleep 1
if curl -fsS http://127.0.0.1:18765/health >/dev/null; then
  info "Bridge is running at http://127.0.0.1:18765"
else
  info "Bridge was installed, but health check failed. Check:"
  info "$HOME/Library/Logs/edge-hermes-copilot/bridge.err.log"
  exit 1
fi

cat <<MSG

Done.

Next:
1. Open edge://extensions/
2. Enable Developer mode
3. Load unpacked extension from:
   $INSTALL_DIR/extension

MSG
