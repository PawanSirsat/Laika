#!/usr/bin/env bash
#
# /laika:standup — what you did in the last 24 hours (SPEC §8, LAI-420).
#
# ## What this actually shows, said plainly
#
# **There is no "my activity" endpoint.** `GET /api/v1/activity` takes `since`,
# `limit`, `cursor` and `task_id` — and no actor filter. So this reads the org
# feed for the window and **selects the rows whose `actor_id` is yours**, which
# every row carries (§4.8).
#
# That is selection, not derivation: no count is computed here that the API did
# not return, and the one number printed is the length of a list the server sent.
# **The command says so on screen**, because "your activity" and "the org's
# activity, filtered here" differ at the page boundary: a busy org can push your
# rows past `limit`, and this reports that rather than quietly showing less.
#
# Owned by SHELL (plugin/). LAI-420.

set -uo pipefail
# shellcheck source=/dev/null
. "$(dirname "${BASH_SOURCE[0]}")/laika-common.sh"

laika_require_config || exit 0

WINDOW_HOURS=24
SINCE=$(( ($(date +%s) - WINDOW_HOURS * 3600) * 1000 ))
LIMIT=100

ME="$(laika_get "/api/v1/me")" || exit 0
FEED="$(laika_get "/api/v1/activity?since=${SINCE}&limit=${LIMIT}")" || exit 0

# The JSON goes in through the environment and the program through a **quoted**
# heredoc, so neither the shell nor Python has to escape the other's quotes. The
# first version used `python3 -c '...'`, which forced `\"` inside f-strings and
# does not parse — it failed on the first real run, having looked correct.
LAIKA_ME="$ME" LAIKA_FEED="$FEED" LAIKA_LIMIT="$LIMIT" LAIKA_HOURS="$WINDOW_HOURS" python3 - <<'PY'
import json, os

me = json.loads(os.environ["LAIKA_ME"])
feed = json.loads(os.environ["LAIKA_FEED"])
limit = int(os.environ["LAIKA_LIMIT"])
hours = os.environ["LAIKA_HOURS"]

rows = feed.get("data", [])
mine = [r for r in rows if r.get("actor_id") == me.get("id")]
name = me.get("name", "You")

print(f"## {name} — last {hours} hours")
print()

if not mine:
    print("No activity of yours in the window.")
    if rows:
        print()
        print(f"({len(rows)} rows from other people in the same window.)")
else:
    for row in mine:
        kind = row.get("type", "?")
        task = row.get("task_id")
        # The feed carries ids, not display keys. `task <id>` is honest;
        # inventing a key from a ULID is not, and there is nothing to resolve
        # one from here.
        where = f" · task {task}" if task else ""
        print(f"- `{kind}`{where}")
    print()
    print(f"{len(mine)} of yours, from {len(rows)} in the window.")

# The page boundary, reported rather than hidden.
if len(rows) >= limit:
    print()
    print(
        f"**The window returned the full page of {len(rows)}**, so older rows in "
        "the last 24 hours were not read. What is above is the most recent page, "
        "not necessarily everything you did."
    )
PY
exit 0
