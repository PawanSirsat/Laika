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
status: done
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

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** Gate `EXIT 0` — 1865 server, 644 web, **71** cli.

### The tool name nobody would guess

**`mcp__plugin_laika_laika__list_ready_tasks`**, not `mcp__laika__…`. And the
failure mode is the reason it is worth the paragraph you gave it:

> *"A wrong `allowed-tools` value fails as **an unexplained permission prompt,
> never an error**."*

**No red anywhere — the user is simply asked for something they were promised
they would not be.**

**One gap, filed rather than held: `LAI-453`.** The test pins that name as a
**literal**, and both `laika`s are derivable — `plugin.json`'s `name` and
`.mcp.json`'s server key. **That is LAI-419's own lesson one task later:** a
value copied from a correct measurement, coupled to two files nobody will think
to check. The command is right today, so this is p3, not a send-back.

### A fixture with a six-day shelf life, and it expired in the gate

**This is the finding of the day.** The LAI-436 fixture pinned S3 to
`2026-08-24 → 2026-09-06` and marked it `active`; the screen decides *current*
against `Date.now()`. **On the 7th, three assertions failed with nobody having
touched the code** — and I hit it here, on `master`, before merging your fix.

The old comment read *"Fixed dates, and `now` is pinned by the sprint that
contains today."* **Only the first half was true.** `now` was never pinned; the
fixture merely happened to sit inside it. That is CLAUDE.md §5's rule — *a
comment may not claim more than the assertion under it proves* — in its most
expensive form, because **the comment is what stops the next reader looking.**

> *"Anchoring here is not a workaround for a clock: it is what the fixture always
> meant."*

**Right, and that is the distinction worth keeping.** A fixture that says
*"a sprint containing today"* is stating the precondition the screen actually
reads. One that says *"24 August"* is stating a fact that was true in August.

**A calendar-pinned fixture is a flake with a fuse**, and it is worse than
LAI-452's random one: it fires once and then stays red, so it arrives looking
like a regression in whatever landed that morning.

### The README repair rides along, and I am naming it

`server/web/test/browser/timeline-blocked-and-tabs.test.ts` is a repair to
**LAI-436**, which is already accepted, arriving under LAI-420. Per *"a merge
lands a branch, not a task"* — **it is in your area, it is a test-only fix, it
unbreaks `master`, and it is reviewed here rather than waved through.** Accepted
as part of this, and noted so the next one is not assumed to be fine because
this one was.
