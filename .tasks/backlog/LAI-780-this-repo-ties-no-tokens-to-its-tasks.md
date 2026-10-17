---
id: LAI-780
title: 'This repo''s own sessions tie no tokens to a task: its branches carry repo ids (LAI-NNN), the board''s prefix is LAIKA, and its agents mark no card'
area: docs
assignee: unclaimed
priority: p2
depends-on: [LAI-770]
discovered-from: LAI-770
status: backlog
---

## Goal

LAI-770 ties a session's tokens to the Laika task its agent marked
(`start_working`, or `update_status` into progress) or, failing that, to a key
in its branch name whose prefix the board serves. Measured on this machine's
31 days after LAI-770 (aggregate only): **17.8%** of headline tokens are now
tied to a task — **all of it ONR**, none LAIKA. The Laika repo's own work
stays at ~0%, for two reasons only the owner and CHIEF can change:

- its branches and task files are named for repo ids, `LAI-770-…` and
  `build-token-attribution`, while the board serves the prefix **`LAIKA`**
  (`LAIKA-474` …) — `LAI` is not a project prefix, so no branch counts; and
- the sessions building it mark no card: the `## Laika` section of
  `CLAUDE.md` asks for `update_status`, but the `LAI-NNN · …` cards cannot be
  found by their repo id through the MCP tools (`get_task_context LAI-770`
  answers `not_found`), so an agent working from a task file has no key to
  mark.

When this is finished, a session building Laika can find the board card for
its task file and mark it, and its branch can carry that card's key.

## Acceptance criteria

- [ ] An agent working from `.tasks/<id>` can learn its card's `LAIKA-N` key
      without a person (a field in the task file, a title search, or a
      mapping the owner chooses).
- [ ] `CLAUDE.md`'s `## Laika` section says to mark that card before work and
      to name the branch `LAIKA-N-…` (or the owner decides otherwise and says
      so there).
- [ ] Re-measured afterwards on this machine: the share of this repo's
      sessions' tokens tied to a task, before and after.

## Notes / context

- Found while measuring LAI-770 (`logs/token-attribution-2026-10-18.md`).
- The collector side needs nothing: a `LAIKA-N` mark or branch already counts.
- An owner decision (D-035's task-file protocol vs the board's keys); no code.
