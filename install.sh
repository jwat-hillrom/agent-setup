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
MIN_NODE_MAJOR=20

# Quotes a value so sh reads it back literally, whatever characters it contains.
sq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

main() {
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
    brew install git node < /dev/null
    if [ "$(node_major)" -lt "$MIN_NODE_MAJOR" ]; then brew upgrade node < /dev/null; fi
  else
    echo "Git and Node $MIN_NODE_MAJOR or newer are required." >&2
    echo "  Debian/Ubuntu: sudo apt-get install git, then Node via https://nodejs.org/en/download (distro Node is often too old)." >&2
    echo "  Fedora/RHEL:   sudo dnf install git nodejs" >&2
    echo "  Any distro:    nvm (https://github.com/nvm-sh/nvm) then 'nvm install --lts'" >&2
    echo "Then re-run this installer." >&2
    exit 1
  fi
}

if ! command -v git >/dev/null 2>&1 || [ "$(node_major)" -lt "$MIN_NODE_MAJOR" ]; then need_tools; fi
[ "$(node_major)" -ge "$MIN_NODE_MAJOR" ] || { echo "Node $MIN_NODE_MAJOR or newer is not on PATH yet. Open a new terminal and re-run." >&2; exit 1; }

if [ -d "$TOOL_DIR/.git" ]; then
  git -C "$TOOL_DIR" pull --ff-only --quiet < /dev/null || echo "warning: could not update the existing tool clone, continuing with what is installed" >&2
else
  mkdir -p "$(dirname "$TOOL_DIR")"
  git clone --quiet --depth 1 -- "$REPO" "$TOOL_DIR" < /dev/null
fi

mkdir -p "$BIN_DIR"
printf '#!/bin/sh\nexec node %s "$@"\n' "$(sq "$TOOL_DIR/agent-setup.mjs")" > "$BIN_DIR/agent-setup"
chmod +x "$BIN_DIR/agent-setup"

if [ "$NO_PATH" = 0 ]; then
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
      case "${SHELL:-}" in
        */zsh) rc="$HOME/.zshrc" ;;
        *) if [ "$(uname)" = "Darwin" ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
      esac
      line="export PATH=$(sq "$BIN_DIR"):\"\$PATH\""
      if grep -qsF -- "$line" "$rc"; then
        :
      elif confirm "Add $BIN_DIR to PATH in $rc?"; then
        printf '\n%s\n' "$line" >> "$rc"
      else
        echo "Add $BIN_DIR to PATH yourself to use the agent-setup command."
      fi
      ;;
  esac
fi

echo "agent-setup installed. Open a new terminal, go to a repository, and run: agent-setup"
echo "On first run you may be asked to sign in to GitHub so the private Baxter skills can be fetched (GitHub does not accept passwords for git: use 'gh auth login' or a credential helper with a personal access token)."
echo "The Taste skill's own scripts also need Node 22+ and Chrome, Edge or Chromium."
}

main "$@"
