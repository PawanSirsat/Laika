#!/bin/sh
# install.sh — set up `laika-claude` on this machine, once.
#
#   git clone https://github.com/PawanSirsat/Laika.git ~/laika
#   ~/laika/plugin/scripts/install.sh
#
# Asks for the board URL and YOUR OWN personal access token, stores them in
# ~/.laika/env (readable only by you), and adds a `laika-claude` command to
# your shell. Nothing is written into any git repository, so a token cannot be
# committed by accident.
#
# Re-running it is safe: it overwrites the stored settings and leaves one
# alias line, not a pile of them.
set -eu

# Resolved through symlinks, the same way the launcher does (LAI-482): if this
# installer is ever reached through one, a bare dirname would make LAUNCHER
# point at a path with no script at it, and the symlink it then creates would
# dangle silently.
SELF="$0"
while [ -L "$SELF" ]; do
  LINK="$(readlink "$SELF")"
  case "$LINK" in
    /*) SELF="$LINK" ;;
    *) SELF="$(dirname "$SELF")/$LINK" ;;
  esac
done
SCRIPT_DIR="$(cd "$(dirname "$SELF")" && pwd)"
CONFIG_DIR="$HOME/.laika"
CONFIG="$CONFIG_DIR/env"

printf '\nLaika — set up the laika-claude command\n'
printf -- '---------------------------------------\n\n'

# --- board URL ------------------------------------------------------------
DEFAULT_URL="${LAIKA_URL:-http://52.72.203.206}"
printf 'Board URL [%s]: ' "$DEFAULT_URL"
read -r URL_INPUT || URL_INPUT=''
URL="${URL_INPUT:-$DEFAULT_URL}"
URL="${URL%/}"

# --- token ----------------------------------------------------------------
printf '\nYour personal access token.\n'
printf '  Get one at %s → sidebar SETTINGS → Tokens → create.\n' "$URL"
printf '  It is shown once. Use YOUR OWN — the board attributes every action\n'
printf '  and every live session to the person who owns the token.\n\n'
printf 'Token (lai_...): '
# Echo off while it is typed: this script exists for onboarding walkthroughs,
# which are exactly the sessions that get screen-shared and recorded. `read -s`
# is bash/zsh only, so stty is the portable way, and the trap puts the terminal
# back even if the person hits Ctrl-C at the prompt.
if [ -t 0 ]; then
  STTY_STATE="$(stty -g 2>/dev/null || true)"
  [ -n "$STTY_STATE" ] && trap 'stty "$STTY_STATE" 2>/dev/null || true' EXIT INT TERM
  stty -echo 2>/dev/null || true
fi
read -r TOKEN || TOKEN=''
if [ -t 0 ] && [ -n "${STTY_STATE:-}" ]; then
  stty "$STTY_STATE" 2>/dev/null || true
  trap - EXIT INT TERM
fi
printf '\n'

if [ -z "$TOKEN" ]; then
  printf '\nNo token given — nothing was written. Re-run when you have one.\n' >&2
  exit 1
fi

case "$TOKEN" in
  lai_*) ;;
  *) printf '\nWarning: that does not look like a Laika token (expected lai_...).\n' ;;
esac

# --- store ----------------------------------------------------------------
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"
umask 077
cat > "$CONFIG" <<EOF
# Laika settings for laika-claude. Personal — do not share or commit.
LAIKA_URL="$URL"
LAIKA_TOKEN="$TOKEN"
EOF
chmod 600 "$CONFIG"
printf '\n  ✓ settings saved to %s (readable only by you)\n' "$CONFIG"

# --- shell command --------------------------------------------------------
LAUNCHER="$SCRIPT_DIR/laika-claude"
chmod +x "$LAUNCHER" 2>/dev/null || true

case "${SHELL:-}" in
  */zsh) RC="$HOME/.zshrc" ;;
  */bash) RC="$HOME/.bashrc" ;;
  *) RC="$HOME/.profile" ;;
esac

# A real command on PATH beats an alias: an alias only exists in interactive
# shells that have sourced the rc since it was added, which is why the first
# thing people hit is `command not found` in the terminal they already had
# open. A symlink in a PATH directory works immediately, everywhere, including
# non-interactive shells. The alias stays as the fallback for a machine with no
# writable PATH directory.
BIN=""
for CANDIDATE in "$HOME/.local/bin" "$HOME/bin" /usr/local/bin; do
  case ":$PATH:" in
    *":$CANDIDATE:"*)
      if [ -d "$CANDIDATE" ] && [ -w "$CANDIDATE" ]; then BIN="$CANDIDATE"; break; fi
      ;;
  esac
done

if [ -z "$BIN" ] && mkdir -p "$HOME/.local/bin" 2>/dev/null; then
  BIN="$HOME/.local/bin"
  NEEDS_PATH=yes
fi

if [ -n "$BIN" ]; then
  ln -sf "$LAUNCHER" "$BIN/laika-claude"
  printf '  ✓ installed the laika-claude command in %s\n' "$BIN"
  if [ "${NEEDS_PATH:-no}" = yes ]; then
    printf '\n# Laika\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$RC"
    printf '  ✓ added %s to your PATH in %s — open a new terminal\n' "$BIN" "$RC"
  fi
else
  # No writable PATH directory: fall back to an alias.
  ALIAS_LINE="alias laika-claude=\"$LAUNCHER\""
  if [ -f "$RC" ] && grep -q 'alias laika-claude=' "$RC"; then
    TMP="$(mktemp)"
    grep -v 'alias laika-claude=' "$RC" > "$TMP"
    printf '%s\n' "$ALIAS_LINE" >> "$TMP"
    cp "$RC" "$RC.laika-backup" 2>/dev/null || true
    cat "$TMP" > "$RC"
    rm -f "$TMP"
    printf '  ✓ updated the laika-claude command in %s (backup: %s.laika-backup)\n' "$RC" "$RC"
  else
    printf '\n# Laika\n%s\n' "$ALIAS_LINE" >> "$RC"
    printf '  ✓ added the laika-claude command to %s\n' "$RC"
  fi
  printf '    (an alias — it applies to terminals opened from now on)\n'
fi

printf '\nDone. Start a new terminal, then from ANY project folder:\n\n'
printf '    laika-claude                              # like `claude`\n'
printf '    laika-claude --dangerously-skip-permissions\n\n'
printf 'Inside the session, /laika:status confirms the connection.\n\n'
