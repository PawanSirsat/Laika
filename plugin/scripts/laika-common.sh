#!/usr/bin/env bash
#
# Shared guards for the /laika: commands (SPEC §8, LAI-420).
#
# Three commands need the same three things — a configured board, a clear word
# when it is not configured, and a clear word when the token is refused — and
# writing them three times is how the four hand-pasted trigger blocks happened.
#
# **Every command exits 0.** A slash command that fails hands the agent an error
# to interpret; a command that explains itself hands the user a sentence. Being
# unconfigured is a normal state, not a fault.
#
# Owned by SHELL (plugin/). Sourced, never executed.

LAIKA_URL_VALUE="${LAIKA_URL:-}"
LAIKA_TOKEN_VALUE="${LAIKA_TOKEN:-}"
LAIKA_BASE="${LAIKA_URL_VALUE%/}"

# --- configuration -----------------------------------------------------------
# Names the variable that is missing rather than saying "not configured": the
# useful half is which one, and a reader who set only one gets told which.
laika_require_config() {
  if [ -z "$LAIKA_URL_VALUE" ] && [ -z "$LAIKA_TOKEN_VALUE" ]; then
    printf 'Laika is not configured — LAIKA_URL and LAIKA_TOKEN are both unset.\n\n'
    printf 'Run `npx laika init` to set them, or see /laika:status.\n'
    return 1
  fi
  if [ -z "$LAIKA_URL_VALUE" ]; then
    printf 'LAIKA_URL is not set, so there is no board to reach.\n\n'
    printf 'Run `npx laika init`, or export it yourself:\n'
    printf '  export LAIKA_URL="https://laika.example.com"\n'
    return 1
  fi
  if [ -z "$LAIKA_TOKEN_VALUE" ]; then
    printf 'LAIKA_TOKEN is not set, so %s will refuse every request.\n\n' "$LAIKA_BASE"
    printf 'Run `npx laika init`, or create a token under Settings -> Tokens.\n'
    return 1
  fi
  return 0
}

# --- one GET, with the failures told apart -----------------------------------
# **`401` is not `unreachable`** — LAI-224's lesson, in the plugin. A refused
# token and a board that is down need different actions from the reader, and
# collapsing them into "could not connect" sends somebody to check their network
# when the answer is that their token was revoked.
#
# The token goes to curl on **stdin**, never in argv: argv is readable in `ps` by
# anyone else on the machine.
laika_get() {
  local path="$1"
  local body status
  local out
  out="$(mktemp)"

  status="$(printf 'header = "Authorization: Bearer %s"\n' "$LAIKA_TOKEN_VALUE" |
    curl --config - \
      --silent --show-error --output "$out" --write-out '%{http_code}' \
      --connect-timeout 5 --max-time 15 \
      --header 'Accept: application/json' \
      "${LAIKA_BASE}${path}" 2>/dev/null)" || status="000"

  body="$(cat "$out" 2>/dev/null)"
  rm -f "$out"

  case "$status" in
    2*)
      printf '%s' "$body"
      return 0
      ;;
    000)
      printf 'Could not reach %s.\n\n' "$LAIKA_BASE" >&2
      printf 'The board may be down, or LAIKA_URL may be wrong. Nothing was sent.\n' >&2
      return 1
      ;;
    401)
      printf 'Your token was refused by %s.\n\n' "$LAIKA_BASE" >&2
      printf 'It may have been revoked or rotated. Run `npx laika init` to mint a new one.\n' >&2
      return 1
      ;;
    403)
      printf 'Your token was accepted but is not allowed to read that.\n\n' >&2
      printf 'A read-only token, or an account without access to this project.\n' >&2
      return 1
      ;;
    *)
      printf '%s answered %s.\n' "$LAIKA_BASE" "$status" >&2
      return 1
      ;;
  esac
}
