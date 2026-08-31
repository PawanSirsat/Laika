---
id: LAI-420
title: The four /laika: slash commands
area: plugin
assignee: unclaimed
priority: p2
depends-on: [LAI-419, LAI-422]
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

**`/laika:setup` is settled — D-046.** **One mechanism, and `npx laika init`
(LAI-422) owns it.** This command invokes the CLI and adds nothing but the
invocation. If a slash command cannot drive an interactive prompt, its job
shrinks to **detecting whether configuration exists and printing the exact
command to run** — still one mechanism, and still useful.

**Do not write a second minting path, and do not write to a second config
location.** Two homes make LAI-422's idempotence criterion unprovable, which is
the argument that decided it.

**Filing it beats faking it.** If invoking an interactive CLI from a slash command
turns out to be hostile, leave `/laika:setup` out and file it — a command that
half-configures is worse than one that tells you what to run. Reasoning in your
log either way, exactly as with `/laika:status`.

## Acceptance criteria

- [ ] `/laika:tasks` calls `list_ready_tasks` and renders ready work — display
      keys (`LAI-42`), p1 first, then oldest. Not raw ULIDs (§7).
- [ ] `/laika:standup` shows the signed-in user's **own** activity over the last
      24h, through an endpoint that exists. If none returns exactly that, use the
      closest one and say what it actually shows rather than implying more.
- [ ] `/laika:status` either ships honestly against today's endpoints **or** is
      filed for M5 — with the choice and its reasoning in your log.
- [ ] `/laika:setup` **invokes `npx laika init` and implements nothing itself**
      (D-046) — or is filed for later, if driving it from a slash command is
      hostile. **Never a second minting path and never a second config file.**
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
