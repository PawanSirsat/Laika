---
id: LAI-420
title: The four /laika: slash commands
area: plugin
assignee: unclaimed
priority: p2
depends-on: [LAI-419]
discovered-from:
status: backlog
---

## Goal

SPEC §8 names four: **`/laika:setup`**, **`/laika:status`** (own capacity),
**`/laika:tasks`** (`list_ready_tasks`), **`/laika:standup`** (own activity, last
24h).

`plugin/commands/status.md` and `plugin/scripts/laika-status.sh` exist as stubs
from LAI-012. Read them before writing anything.

## Two of these have a problem. Read this before starting.

**`/laika:status` shows "own capacity", and capacity is M5.** `GET /api/v1/capacity`
does not exist. Options, in order of preference: build the command against what
*does* exist today (own in-progress tasks via `list_ready_tasks` plus the task
detail), and say plainly on the command that capacity arrives in M5 — **or**, if
that is not honest enough to ship, leave `/laika:status` out and file it with
`depends-on` the M5 capacity endpoint. **Do not invent a capacity number.**

**`/laika:setup` overlaps `npx laika init` (LAI-422).** §8 says `/laika:setup`
writes `LAIKA_URL` and `LAIKA_TOKEN` into user settings; the ROADMAP says the CLI
does "authenticate, mint a token, write local config". Those may be one mechanism
with two front doors, or two different things. **The spec does not say, and this
is not yours to settle by implementing** — LAI-139's rule. Raise it and CHIEF
will decide. Build the other commands meanwhile.

## Acceptance criteria

- [ ] `/laika:tasks` calls `list_ready_tasks` and renders ready work — display
      keys (`LAI-42`), p1 first, then oldest. Not raw ULIDs (§7).
- [ ] `/laika:standup` shows the signed-in user's **own** activity over the last
      24h, through an endpoint that exists. If none returns exactly that, use the
      closest one and say what it actually shows rather than implying more.
- [ ] `/laika:status` either ships honestly against today's endpoints **or** is
      filed for M5 — with the choice and its reasoning in your log.
- [ ] `/laika:setup` is **not implemented until CHIEF resolves the overlap.**
      Filing beats guessing.
- [ ] Every command **degrades clearly when unconfigured or refused** — names the
      missing variable, or says the token was refused. Never a stack trace.
- [ ] No command invents, caches or derives a number the API did not return.
      CLAUDE.md §5.1's rule is not only for the SPA.
- [ ] Full gate green.

## Notes

No new dependencies.

These are the agent-facing equivalents of `/claim` and `/standup` in `.claude/`.
**They are not the same files and must not import from them** — `.claude/` configures
the three sessions building Laika; `plugin/` is what ships to users. `.sessions/shell.md`
records the distinction.
