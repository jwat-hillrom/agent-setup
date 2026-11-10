#!/usr/bin/env bash
# Installs agent-setup on macOS or Linux: checks Git and Node, fetches the tool, adds an `agent-setup` command.
# Safe to re-run. Usage: install.sh [--yes] [--no-path] [--repo URL] [--tool-dir DIR] [--bin-dir DIR]
#   curl -fsSL https://raw.githubusercontent.com/jwat-hillrom/agent-setup/main/install.sh | bash
set -eu

REPO="${AGENT_SETUP_REPO:-https://github.com/jwat-hillrom/agent-setup.git}"
TOOL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/agent-setup/tool"
BIN_DIR="$HOME/.local/bin"
YES=0
NO_PATH=0
MIN_NODE_MAJOR=18

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1 ;;
    --no-path) NO_PATH=1 ;;
    --repo) REPO="$2"; shift ;;
    --tool-dir) TOOL_DIR="$2"; shift ;;
    --bin-dir) BIN_DIR="$2"; shift ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

confirm() {
  [ "$YES" = 1 ] && return 0
  printf '%s [Y/n] ' "$1"
  read -r answer < /dev/tty || return 1
  case "$answer" in n|N|no|NO) return 1 ;; *) return 0 ;; esac
}

node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

need_tools() {
  if [ "$(uname)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    confirm "Git and Node $MIN_NODE_MAJOR+ are required. Install them with Homebrew?" || { echo "Git and Node are required." >&2; exit 1; }
    brew install git node
  else
    echo "Git and Node $MIN_NODE_MAJOR or newer are required. Install them with your package manager (https://nodejs.org/en/download), then re-run." >&2
    exit 1
  fi
}

if ! command -v git >/dev/null 2>&1 || [ "$(node_major)" -lt "$MIN_NODE_MAJOR" ]; then need_tools; fi
[ "$(node_major)" -ge "$MIN_NODE_MAJOR" ] || { echo "Node $MIN_NODE_MAJOR or newer is not on PATH yet. Open a new terminal and re-run." >&2; exit 1; }

if [ -d "$TOOL_DIR/.git" ]; then
  git -C "$TOOL_DIR" pull --ff-only --quiet
else
  mkdir -p "$(dirname "$TOOL_DIR")"
  git clone --quiet --depth 1 "$REPO" "$TOOL_DIR"
fi

mkdir -p "$BIN_DIR"
printf '#!/bin/sh\nexec node "%s/agent-setup.mjs" "$@"\n' "$TOOL_DIR" > "$BIN_DIR/agent-setup"
chmod +x "$BIN_DIR/agent-setup"

if [ "$NO_PATH" = 0 ]; then
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
      case "${SHELL:-}" in */zsh) rc="$HOME/.zshrc" ;; *) rc="$HOME/.bashrc" ;; esac
      if confirm "Add $BIN_DIR to PATH in $rc?"; then
        printf '\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$rc"
      else
        echo "Add $BIN_DIR to PATH yourself to use the agent-setup command."
      fi
      ;;
  esac
fi

echo "agent-setup installed. Open a new terminal, go to a repository, and run: agent-setup"
echo "On first run you may be asked to sign in to GitHub so the private Baxter skills can be fetched."
echo "The Taste skill's own scripts also need Node 22+ and Chrome, Edge or Chromium."
