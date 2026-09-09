#!/usr/bin/env bash
#
# laika-status.sh — report how this session is wired to a Laika board.
#
# Prints the board URL and whether a token is present. It NEVER prints the
# token itself, and it always exits 0: a status check must not break a coding
# session, and an unconfigured plugin is a normal state, not an error.
#
# Owned by Builder-B (plugin/). See LAI-012.

set -uo pipefail

VERSION="0.1.0"
URL="${LAIKA_URL:-}"
TOKEN="${LAIKA_TOKEN:-}"

# --- token: describe it, never reveal it -------------------------------------
# Only the constant prefix and the length are reported. Both are format facts,
# not secret material, and they are what actually diagnoses a bad paste.
describe_token() {
  if [ -z "$TOKEN" ]; then
    printf 'not set'
    return
  fi
  local n=${#TOKEN}
  case "$TOKEN" in
    lai_*) printf 'present (lai_ prefix, %d chars)' "$n" ;;
    *)     printf 'present but malformed (%d chars, expected a lai_ prefix)' "$n" ;;
  esac
}

printf 'Laika plugin v%s\n\n' "$VERSION"

if [ -z "$URL" ]; then
  printf '  Board URL   not set                (LAIKA_URL)\n'
  printf '  Token       %s\n\n' "$(describe_token)"
  cat <<'MSG'
Not configured — the plugin is loaded, but there is no board to talk to. This
is safe to leave installed; the Laika MCP server simply has nothing to reach.

To configure, set both variables in the environment Claude Code starts in:

  export LAIKA_URL="https://laika.example.com"   # your deployment, no trailing slash
  export LAIKA_TOKEN="lai_..."                   # Settings -> Tokens on that board

Then restart Claude Code so the MCP server picks them up.
MSG
  exit 0
fi

# Trailing slashes produce "https://host//mcp"; report the URL as it will be used.
BASE="${URL%/}"

printf '  Board URL   %s\n' "$BASE"
printf '  Token       %s\n' "$(describe_token)"
printf '  MCP server  laika -> %s/mcp\n' "$BASE"

if [ "$BASE" != "$URL" ]; then
  printf '\n  Note: LAIKA_URL has a trailing slash; it is trimmed before use.\n'
fi

case "$BASE" in
  https://*) ;;
  http://localhost*|http://127.0.0.1*) ;;
  http://*)
    printf '\n  Warning: LAIKA_URL is plain http. Your token is sent on every\n'
    printf '           request — use https outside localhost.\n' ;;
  *)
    printf '\n  Warning: LAIKA_URL has no http(s) scheme; the MCP server will not\n'
    printf '           connect. Expected something like https://laika.example.com\n' ;;
esac

if [ -z "$TOKEN" ]; then
  printf '\n  A board URL without a token gets 401 on every call. Create one under\n'
  printf '  Settings -> Tokens and export it as LAIKA_TOKEN.\n'
  exit 0
fi

# --- own capacity, from the board (§8, LAI-420) ------------------------------
# **This is the part that talks to the network**, and everything above still
# works without it. `GET /api/v1/capacity` is live (LAI-432); the task file's
# hedge that capacity is M5 was stale by the time this was written.
#
# Nothing is computed here. `active_sessions`, the task counts and `unlisted`
# arrive decided; this prints the row belonging to the person whose token it is.
# shellcheck source=/dev/null
. "$(dirname "${BASH_SOURCE[0]}")/laika-common.sh"

printf '\n'
ME="$(laika_get "/api/v1/me")" || exit 0
CAPACITY="$(laika_get "/api/v1/capacity")" || exit 0

LAIKA_ME="$ME" LAIKA_CAPACITY="$CAPACITY" python3 - <<'PY'
import json, os

me = json.loads(os.environ["LAIKA_ME"])
cap = json.loads(os.environ["LAIKA_CAPACITY"])

if not cap.get("enabled", True):
    # `enabled: false` and an empty list are opposite claims (§4.2): this org
    # records nothing, which is not the same as nobody working.
    print("  Capacity    presence is off for this organisation")
    raise SystemExit(0)

mine = next((p for p in cap.get("people", []) if p.get("user_id") == me.get("id")), None)
if mine is None:
    print("  Capacity    no row for you on this board")
    raise SystemExit(0)

print(f"  Signed in   {me.get('name')} ({me.get('org_role')})")
print(f"  Sessions    {mine.get('active_sessions', 0)}")
print(f"  In progress {len(mine.get('in_progress_tasks', []))}")
print(f"  In review   {len(mine.get('tasks_in_review', []))}")

# **Absent, not empty** for a reader without `audit_log.export`. Printing `0`
# would claim they have logged nothing, which is a different statement.
if "unlisted" in mine:
    print(f"  Unlisted    {len(mine['unlisted'])}")
PY

exit 0
