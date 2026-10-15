#!/usr/bin/env bash
#
# heartbeat.sh — tell a Laika board that this session is alive (SPEC §8, §9.1).
#
# Invoked by hooks.json on SessionStart, on Stop, and on PostToolUse. POSTs
# `{ repo, branch }` to $LAIKA_URL/api/v1/heartbeats with a bearer token.
#
# ## Metadata only (D-005, §9.1, §13.4)
#
# The remote and the branch name. Never a path, never a diff, never a prompt.
# §9.1 calls this "the one place where a tempting feature would cost the trust
# the product is built on" — if a value looks useful here and is not the remote
# or the branch, the answer is no.
#
# ## It must never break a coding session (§8)
#
# That is the whole contract, and it is why this script has no `set -e`, ends in
# `exit 0`, and says nothing on any path. A board that is down, slow,
# unreachable or simply not configured is a normal state. The `|| true` in
# hooks.json is a second layer for the case this file cannot cover itself —
# missing, unreadable, or not executable.
#
# ## The remote is sent verbatim (D-043, LAI-144)
#
# Whatever `git config --get remote.origin.url` printed, unparsed. §9.1
# normalises it server-side, because the server is the only side that can be
# fixed after a plugin ships. A hook that half-normalises invents a form the
# server then has to guess at. Do not add a `sed` here.
#
# Owned by SHELL (plugin/). LAI-418.

set -uo pipefail

MODE="${1:-tool-use}"
URL="${LAIKA_URL:-}"
TOKEN="${LAIKA_TOKEN:-}"

# §9.3: presence is "a heartbeat in the last 5 minutes" — `PRESENCE_WINDOW_MS`
# in server/src/services/presence.ts. At most one post per session per 90 s,
# under a third of that window: a session that is working posts at least three
# times inside any window, so one lost post never drops it from the board.
# Throttling at the full 300 s (as this did before LAI-752) left no margin: a
# post at 0 s and the next tool use at 301 s was a gap the board showed as gone.
THROTTLE_SECONDS=90

# Opt-in, off by default, and it never prints the token. Presence being silently
# empty is the failure this diagnoses, and without it the only way to tell "not
# configured" from "posted and rejected" is a packet capture.
note() {
  [ -n "${LAIKA_HEARTBEAT_DEBUG:-}" ] && printf 'laika heartbeat: %s\n' "$1" >&2
  return 0
}

# --- unconfigured is silent, not broken (§8) ---------------------------------
# Most repositories on most machines have never heard of Laika. A hook that
# warns on session start in every one of them is a defect, not a courtesy.
if [ -z "$URL" ] || [ -z "$TOKEN" ]; then
  note "not configured (LAIKA_URL / LAIKA_TOKEN unset) — nothing sent"
  exit 0
fi

# --- throttle, before anything forks ----------------------------------------
# Keyed by the session, which every hook payload names (`session_id`, first in
# what Claude Code writes). Decided before git runs: this script fires on every
# tool use, and the throttled path used to cost two `git` processes, a `cksum`
# and an `id` each time (≈50 ms) to decide to do nothing. Now it is one `date`.
#
# Only the first 1 KiB of stdin is read, by a builtin, and nothing but the id
# is kept. A payload without one (a hand run, another runner) shares one key
# per user. SessionStart is never throttled — sitting down is exactly the moment
# the board should know — and a move to another branch or repo reaches the
# board within one throttle period rather than at once.
SESSION=''
if [ ! -t 0 ]; then
  INPUT=''
  IFS= read -r -d '' -n 1024 -t 2 INPUT || true
  SESSION_RE='"session_id"[[:space:]]*:[[:space:]]*"([A-Za-z0-9_.-]{1,128})"'
  if [[ $INPUT =~ $SESSION_RE ]]; then SESSION="${BASH_REMATCH[1]}"; fi
  INPUT=''
fi
STAMP="${TMPDIR:-/tmp}/laika-heartbeat-${UID:-0}-${SESSION:-nosession}"
NOW="$(date +%s)"

if [ "$MODE" != "session-start" ]; then
  LAST=''
  { IFS= read -r LAST <"$STAMP"; } 2>/dev/null || true
  case "$LAST" in '' | *[!0-9]*) LAST=0 ;; esac
  if [ "$((NOW - LAST))" -lt "$THROTTLE_SECONDS" ]; then
    note "throttled ($((NOW - LAST))s since the last one, limit ${THROTTLE_SECONDS}s)"
    exit 0
  fi
fi

# Stamped before the request, not after: a board that is down must not turn
# every tool call into a two-second connect attempt.
printf '%s' "$NOW" >"$STAMP" 2>/dev/null || true

# --- what git says, or nothing -----------------------------------------------
# No repository, no remote, or no commit yet all mean there is nothing to report
# and are not errors. Both are needed: §9.1's body requires them, and a
# heartbeat with an empty branch is refused with 422 rather than degrading.
REPO="$(git config --get remote.origin.url 2>/dev/null || true)"
# `git branch --show-current`, and not `git rev-parse --abbrev-ref HEAD`, which
# was here first and was measurably wrong twice. On a repository with no commit
# yet it **exits 128 and still prints `HEAD` on stdout** — a failure `|| true`
# swallows while leaving a plausible value behind — and on a detached HEAD it
# prints `HEAD` as though that were a branch. `--show-current` gives the real
# name on an unborn branch and gives nothing when there is genuinely no branch,
# which is the case §9.1 wants skipped rather than reported.
BRANCH="$(git branch --show-current 2>/dev/null || true)"

if [ -z "$REPO" ] || [ -z "$BRANCH" ]; then
  note "no git remote or no branch here — nothing sent"
  exit 0
fi

# --- send --------------------------------------------------------------------
# Escapes for a JSON string and for a curl config value, which take the same two.
# A branch name may legally contain a double quote; `git check-ref-format`
# rejects a backslash, but the remote URL is arbitrary text and does not.
escape_quoted() {
  printf '%s' "$1" | tr -d '\000-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

BODY="$(printf '{"repo":"%s","branch":"%s"}' "$(escape_quoted "$REPO")" "$(escape_quoted "$BRANCH")")"

# The token goes in on stdin, never in argv. `-H "Authorization: Bearer $TOKEN"`
# is what §8's snippet shows and it is readable in `ps` by every other user on
# the machine, for as long as the request takes, several times an hour. The
# plugin README already says no secret on the command line; the command line of
# curl is still a command line.
#
# Timeouts are short and both are needed: --max-time alone still waits out a
# connect to a host that is silently dropping packets. hooks.json adds a third
# bound around the script itself.
printf 'header = "Authorization: Bearer %s"\n' "$(escape_quoted "$TOKEN")" |
  curl --config - \
    --silent --output /dev/null \
    --connect-timeout 2 --max-time 3 \
    --request POST \
    --header 'Content-Type: application/json' \
    --data-binary "$BODY" \
    "${URL%/}/api/v1/heartbeats" >/dev/null 2>&1 || true

note "sent ($MODE) repo=$REPO branch=$BRANCH"
exit 0
