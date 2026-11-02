#!/bin/sh
# install.sh — set up the `laika` and `laika-claude` commands on this machine.
#
# The V3 path (LAI-1060) asks for no token and writes none:
#
#   git clone <the board's source URL> ~/laika
#   git -C ~/laika checkout --detach <the board's commit>
#   ~/laika/plugin/scripts/install.sh --no-credential
#   laika device pair --board <board> --code <code>     # the browser shows this
#
# Each tool then gets its own credential with `laika tool add` (the browser
# shows that command too), kept in ~/.laika/agents/<tool>.json.
#
# Without --no-credential it is the older path: it asks for the board URL and
# YOUR OWN personal access token and stores them in ~/.laika/env (readable only
# by you). An existing ~/.laika/env is kept as env.bak-<seconds> first. Nothing
# is written into any git repository, so a token cannot be committed by
# accident.
#
# Re-running it is safe: it leaves one PATH line and one alias line, not a pile
# of them.
set -eu

NO_CREDENTIAL=no
for ARG in "$@"; do
  case "$ARG" in
    --no-credential) NO_CREDENTIAL=yes ;;
    -h | --help)
      sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'install.sh: unknown option %s (try --no-credential)\n' "$ARG" >&2
      exit 1
      ;;
  esac
done

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

printf '\nLaika — set up the laika and laika-claude commands\n'
printf -- '---------------------------------------------------\n\n'

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

# The CLI lives beside the plugin in the same checkout. SCRIPT_DIR is already
# resolved through symlinks above, so this inherits that fix rather than
# repeating the bug it fixed (LAI-482).
CLI="$(cd "$SCRIPT_DIR/../.." && pwd)/cli/bin/laika"

if [ -n "$BIN" ]; then
  # Same guard as `laika` below. `laika-claude` is a Laika-specific name so a
  # collision is unlikely — but "unlikely" was the reasoning that left the hole
  # below, and a sweep of both `ln -sf` sites costs four lines.
  if EXISTING_LC="$(command -v laika-claude 2>/dev/null)" &&
    [ -n "$EXISTING_LC" ] &&
    [ ! -L "$EXISTING_LC" ]; then
    printf '  ! something else called laika-claude is on your PATH (%s) — skipping\n' "$EXISTING_LC"
  else
    ln -sf "$LAUNCHER" "$BIN/laika-claude"
    printf '  ✓ installed the laika-claude command in %s\n' "$BIN"
  fi
  # `laika init` and `laika whoami` are printed by the Tokens screen, by the
  # Connect screen and by three of the plugin's own failure messages. They were
  # printed as `npx laika init`, which cannot work from a clean machine (the
  # package is private and unpublished) — linking the command is what makes
  # them real.
  #
  # Guarded twice: a link pointing at nothing is LAI-482's defect, and
  # clobbering an unrelated `laika` already on PATH would be worse than not
  # installing at all.
  #
  # The test for "ours" is **is it a symlink**, and nothing else. An earlier
  # version also required `"$EXISTING" != "$BIN/laika"`, meaning to say "do not
  # refuse our own link on a re-run" — but our own link is caught by `-L`
  # anyway, so that clause only ever excused the one case that matters: a real
  # file somebody else put at the exact path we install to. Measured in
  # cli/test/laika-command.test.ts, which overwrote a foreign `laika` and
  # reported success.
  if [ ! -f "$CLI" ]; then
    printf '  ! no CLI at %s — skipping the laika command\n' "$CLI"
  elif EXISTING="$(command -v laika 2>/dev/null)" &&
    [ -n "$EXISTING" ] &&
    [ ! -L "$EXISTING" ]; then
    printf '  ! something else called laika is already on your PATH (%s) — skipping\n' "$EXISTING"
  else
    ln -sf "$CLI" "$BIN/laika"
    printf '  ✓ installed the laika command in %s\n' "$BIN"
  fi

  # Once, however often this runs (LAI-1060): the marker line is what is
  # looked for, so a second run adds nothing.
  PATH_MARKER='# Laika — put ~/.local/bin on PATH (install.sh)'
  if [ "${NEEDS_PATH:-no}" = yes ]; then
    if [ -f "$RC" ] && grep -qF "$PATH_MARKER" "$RC"; then
      printf '  · %s already puts %s on your PATH — open a new terminal\n' "$RC" "$BIN"
    else
      printf '\n%s\nexport PATH="$HOME/.local/bin:$PATH"\n' "$PATH_MARKER" >> "$RC"
      printf '  ✓ added %s to your PATH in %s — open a new terminal\n' "$BIN" "$RC"
    fi
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

if [ "$NO_CREDENTIAL" = yes ]; then
  # The V3 path stops here: no token asked for, ~/.laika/env left as it is.
  printf '\n  · --no-credential: no token asked for; %s is left as it is\n' "$CONFIG"
  printf '\nDone. Start a new terminal, then pair this machine with your board.\n'
  printf 'In the browser, Developer access → Add device shows the exact command:\n\n'
  printf '    laika device pair --board <board> --code <code>\n\n'
  printf 'Then add each tool there; it shows a `laika tool add …` command to run here.\n'
  exit 0
fi

# --- board URL ----------------------------------------------------------
DEFAULT_URL="${LAIKA_URL:-http://52.72.203.206}"
printf 'Board URL [%s]: ' "$DEFAULT_URL"
read -r URL_INPUT || URL_INPUT=''
URL="${URL_INPUT:-$DEFAULT_URL}"
URL="${URL%/}"

# --- token --------------------------------------------------------------
printf '\nYour personal access token.\n'
printf '  Get one at %s → Developer access → Tokens (Advanced, in the new\n' "$URL"
printf '  layout) → create. It is shown once. Use YOUR OWN — the board attributes\n'
printf '  every action and every live session to the person who owns the token.\n'
printf '  (Pairing this machine instead? Re-run with --no-credential.)\n\n'
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
  printf '\nNo token given — no settings were written. Re-run when you have one.\n' >&2
  exit 1
fi

case "$TOKEN" in
  lai_*) ;;
  *) printf '\nWarning: that does not look like a Laika token (expected lai_...).\n' ;;
esac

# --- store --------------------------------------------------------------
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"
umask 077
# The settings already here may be somebody's only copy of their token
# (LAI-1060, plan LAI-1042 §A8): kept, 0600, before anything replaces them.
if [ -f "$CONFIG" ]; then
  BACKUP="$CONFIG.bak-$(date +%s)"
  cp "$CONFIG" "$BACKUP"
  chmod 600 "$BACKUP"
  printf '\n  ✓ kept the previous settings as %s\n' "$BACKUP"
fi
cat > "$CONFIG" <<EOF
# Laika settings for laika-claude. Personal — do not share or commit.
LAIKA_URL="$URL"
LAIKA_TOKEN="$TOKEN"
EOF
chmod 600 "$CONFIG"
printf '\n  ✓ settings saved to %s (readable only by you)\n' "$CONFIG"

printf '\nDone. Start a new terminal, then from ANY project folder:\n\n'
printf '    laika-claude                              # like `claude`\n'
printf '    laika-claude --dangerously-skip-permissions\n\n'
printf 'Inside the session, /laika:status confirms the connection.\n'
printf 'From a plain terminal, laika whoami says who this machine is.\n\n'
# LAI-737: the same stored board and token serve every other coding agent.
printf 'Another coding agent (Codex, Cursor, Gemini CLI, OpenCode, ...)? Run:\n\n'
printf '    laika connect <agent>                     # laika connect --list for names\n\n'
