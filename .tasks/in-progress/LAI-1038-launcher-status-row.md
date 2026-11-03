---
id: LAI-1038
title: 'Launcher status row per device in Developer access › Agents › Your devices'
area: server
assignee: core
priority: p3
depends-on: [LAI-558]
discovered-from: LAI-558
status: in-progress
started: 2026-11-03T14:27:03+05:30
---

## Goal

D-117 item 7: show a read-only *Launcher* row per device in *Developer access ›
Agents › Your devices* — enabled?, last start, running count — once the board
has data to show.

## Why it is not built yet

The launcher (LAI-558) keeps its state on the device only
(`~/.laika/launcher/status.json`, `audit.jsonl`). The board has no field for it,
and §5.1 forbids building the screen on stubbed data. This needs, in order:

1. **CORE:** a minimal, read-only report — e.g. the launcher sending
   `{ enabled, running, last_start_at }` with the agent's own token on its
   existing poll, kept per agent/device, never a command channel. A SPEC §6.4
   row and its `can()` action.
2. **SHELL:** the CLI sending it (`cli/src/agent-launcher.ts`), and the row in
   `server/web/` with Playwright evidence in both themes.

## Acceptance criteria

- [ ] The board stores only the three read-only facts; nothing on it can start,
      stop or configure a launcher (D-117: no general runner).
- [ ] The row shows "Launcher: off" when a device has never reported.
- [ ] Repo-root gate exits 0.

## Claim note — slice A of the auto-pickup plan (2026-11-03, core, dispatched by CHIEF)

Claimed as **slice A** of `.polly/plans/auto-pickup-capacity.md` §8, which
"absorbs LAI-1038's server half": step 1 above, plus the capacity ping D-126
puts beside it (D-126's header names this task). The decisions are D-117a,
D-126 and D-127, written by CHIEF in PR #251; this branch cites them and
writes none. Its SPEC rows are the named CHIEF crossing the plan gives slice A.

**Deviation from §2 step 1, recorded rather than read loosely:** `depends-on`
names LAI-558, which is in `.tasks/review/` on `master`. CHIEF accepts it in
PR #251 (`chore(tasks): accept LAI-553, LAI-554, LAI-558, LAI-1041`) and
dispatched this slice against that acceptance.

**How the criteria above read for slice A.** The first is amended by D-126
item 4: the report is the closed object D-126 names, and it stays read-only —
nothing on the board starts, stops or configures a launcher. The second is
the web row (slice C): this branch serves `launcher.state: 'off'` for an agent
or device that never reported, which is what that row reads. The third cannot
hold for this half alone: the new §4.8 verb is three owners (CLAUDE.md §4.4),
so this branch is submitted red on the web mirrors only, quoted in the review
note when it moves to review, and turned green by slice C landing on top.
