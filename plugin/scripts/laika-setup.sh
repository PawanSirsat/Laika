#!/usr/bin/env bash
#
# /laika:setup — tell the user how to configure, and configure nothing (D-046).
#
# ## Why this command implements nothing
#
# **One mechanism owns configuration and it is `npx laika init`** (D-046,
# LAI-422). This detects what is already set and prints the exact command; it
# mints no token and writes no file.
#
# The reason is LAI-422's idempotence criterion: *"a second run does not silently
# mint a second token"*. That is only provable while there is **one** place a
# configuration can live. A slash command with its own minting path would make
# "already configured" mean "configured somewhere I happen to look", and the
# criterion would become unfalsifiable rather than merely unmet.
#
# A slash command also cannot drive an interactive prompt — `init` asks for an
# email and a password, and a password must never come from a command line
# (LAI-422). So the honest shape is: say what is set, say what to run.
#
# Owned by SHELL (plugin/). LAI-420.

set -uo pipefail
# shellcheck source=/dev/null
. "$(dirname "${BASH_SOURCE[0]}")/laika-common.sh"

SETTINGS="$HOME/.claude/settings.json"

printf 'Laika configuration\n\n'

if [ -n "$LAIKA_URL_VALUE" ] && [ -n "$LAIKA_TOKEN_VALUE" ]; then
  printf '  Board   %s\n' "$LAIKA_BASE"
  printf '  Token   present\n\n'
  printf 'Already configured. `/laika:status` checks it against the board.\n\n'
  printf 'To point at a different board, or after revoking a token:\n\n'
  printf '  npx laika init\n\n'
  printf 'It writes both variables to %s and is safe to re-run — it stops rather\n' "$SETTINGS"
  printf 'than minting a second token when one is already there.\n'
  exit 0
fi

if [ -n "$LAIKA_URL_VALUE" ]; then
  printf '  Board   %s\n' "$LAIKA_BASE"
  printf '  Token   not set\n\n'
elif [ -n "$LAIKA_TOKEN_VALUE" ]; then
  printf '  Board   not set\n'
  printf '  Token   present\n\n'
  printf 'A token without a board reaches nothing.\n\n'
else
  printf '  Board   not set\n'
  printf '  Token   not set\n\n'
fi

cat <<'MSG'
Run this in a terminal — not here, because it asks for your password and a
password typed into a chat is a password in a transcript:

  npx laika init

It asks for your board URL, your email and your password, mints a personal
access token, and writes LAIKA_URL and LAIKA_TOKEN to ~/.claude/settings.json.
The password is never stored; the token is shown once and written straight to
that file.

Restart Claude Code afterwards so the MCP server picks the variables up.
MSG
exit 0
