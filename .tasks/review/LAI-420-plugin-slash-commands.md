---
id: LAI-420
title: The four /laika: slash commands
area: plugin
assignee: shell
priority: p2
depends-on: [LAI-419, LAI-422]
discovered-from:
started: 2026-09-01T23:15:00+05:30
finished: 2026-09-02T00:20:00+05:30
status: review
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

- [x] `/laika:tasks` calls `list_ready_tasks` and renders ready work — display
      keys (`LAI-42`), p1 first, then oldest. Not raw ULIDs (§7).
- [x] `/laika:standup` shows the signed-in user's **own** activity over the last
      24h, through an endpoint that exists. If none returns exactly that, use the
      closest one and say what it actually shows rather than implying more.
- [x] `/laika:status` either ships honestly against today's endpoints **or** is
      filed for M5 — with the choice and its reasoning in your log.
- [x] `/laika:setup` **invokes `npx laika init` and implements nothing itself**
      (D-046) — or is filed for later, if driving it from a slash command is
      hostile. **Never a second minting path and never a second config file.**
- [x] Every command **degrades clearly when unconfigured or refused** — names the
      missing variable, or says the token was refused. Never a stack trace.
- [x] No command invents, caches or derives a number the API did not return.
      CLAUDE.md §5.1's rule is not only for the SPA.
- [x] Full gate green.

## Notes

No new dependencies.

These are the agent-facing equivalents of `/claim` and `/standup` in `.claude/`.
**They are not the same files and must not import from them** — `.claude/` configures
the three sessions building Laika; `plugin/` is what ships to users. `.sessions/shell.md`
records the distinction.


---

## Submitted — SHELL

**All four of §8 ship.** None filed. Root gate `EXIT 0` — 1836 server, 644 web,
**71** cli. Six mutations, all red.

Every command was run against a real board on `:3371`, not reasoned about.

### `/laika:status` — capacity is live, so no hedge

The task offers to defer this because *"capacity is M5"*. `GET /api/v1/capacity`
exists (LAI-432) and answered:

```
  Signed in   Ada Lovelace (owner)
  Sessions    1        In progress 0
  In review   0        Unlisted    0
```

Nothing is computed. `unlisted` prints only when the key is present — **absent
means "you may not be told", and `0` would claim they have logged nothing.**

### `/laika:setup` — D-046, and it implements nothing

It reports what is set and prints `npx laika init`. It mints nothing, writes
nothing, and prompts for nothing, because a second path would make LAI-422's
*"does not silently mint a second token"* **unprovable rather than merely unmet**
— "already configured" would come to mean "configured somewhere I happen to
look".

It also says to run it **in a terminal, not here**: `init` asks for a password,
and a password typed into a chat is a password in a transcript.

### `/laika:standup` — and what it actually shows

**There is no per-actor activity endpoint.** `GET /activity` takes `since`,
`limit`, `cursor`, `task_id` and no actor filter. So it reads the org feed for 24
hours and selects rows whose `actor_id` is the caller's — and **says so**, and
reports when the window returned a full page so older rows went unread rather
than implying the list is complete.

### Two things only a real run could have told me

**The MCP tool name.** I wrote `mcp__laika__list_ready_tasks` in `allowed-tools`
from the obvious pattern. The real name is
**`mcp__plugin_laika_laika__list_ready_tasks`** — `mcp__plugin_<plugin>_<server>__<tool>`.
A wrong value there fails as an unexplained permission prompt, not an error.
Measured by asking a session to print the names it could see.

**The tool returns two payloads and the client's choice varies.** The wire
carries a rendered `text` block *and* a `structuredContent` object with ULIDs.
My first instruction said *"returns markdown, render as-is"* — a run answered
*"the tool returned raw JSON"*. I corrected it to *"show the text block"* — the
next run answered *"only the structured payload came through this time"*. **Both
were true of the wire and false of what the agent held.** The instruction is now
about the **output**: display keys, never an `id`, whichever payload arrives.

### And two assertions of my own that could not tell explaining from doing

`assert.ok(!script.includes('password'))` failed on the *explanation* that `npx
laika init` will ask for one. The property is that the script does not **read
input**, and it asserts that now. The other failed on a **line break** inside the
phrase it was matching. Same shape as LAI-157's `heartbeat` assertion.

### Found while gating: my LAI-436 fixture had a six-day shelf life

`timeline-blocked-and-tabs.test.ts` pinned sprints to fixed dates with the
"current" one ending **6 September**. The screen decides *current* against
`Date.now()`, so on the 7th the active sprint became S4 and three assertions
failed — **in the gate, not in review**.

Anchored to today, which is what the fixture always meant: *"a sprint containing
today"* is the property, and a date only happened to be that in the week it was
written. `timeline-bars.test.ts` (LAI-434) has fixed dates too but asserts only
bar shape, so it is latent rather than broken — left alone, and noted.
