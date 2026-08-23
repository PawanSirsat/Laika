---
id: LAI-013
title: Resolve the heartbeat ordering — M4 hooks post to an M5 endpoint
area: docs
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-012
status: backlog
---

## Goal

`docs/ROADMAP.md` puts the plugin's heartbeat hooks in **M4** ("Hooks: heartbeat
on session start and on a timer, branch detection") but puts the endpoint they
POST to, `POST /api/v1/heartbeats`, in **M5**. As written, M4 ships hooks that
have nothing to talk to for a whole milestone.

It is survivable — SPEC §8 requires the hook to fail silent (`|| true`), so a
missing endpoint degrades to a no-op rather than breaking a coding session — but
it means M4 cannot be verified end to end, and whoever builds the hooks has no
way to test them. PM should decide which way to resolve it rather than leaving
the next Builder-B session to guess.

## Acceptance criteria

- [ ] `docs/ROADMAP.md` is unambiguous about where heartbeats land: either
      `POST /api/v1/heartbeats` moves to M3/M4, or the hooks move to M5, or the
      M4 entry states plainly that hooks ship dark and are verified in M5.
- [ ] If the resolution changes what M4 delivers, the M4 exit criterion is
      updated to match — an exit criterion that cannot be demonstrated is not an
      exit criterion.
- [ ] `plugin/hooks/README.md` currently carries a "Sequencing note" pointing at
      this task. Once resolved, a task with `area: plugin` is filed to bring
      that note in line (Builder-B owns that file — do not edit it from a docs
      task).

## Notes / context

Found while writing `plugin/hooks/README.md` under LAI-012, which had to state
which milestone fills the directory and could not answer the question honestly.

Relevant: `docs/ROADMAP.md` M4 and M5, SPEC §8 (hook payload, fail-silent rule),
SPEC §4.10 `heartbeats` table, SPEC §9.1 (`POST /heartbeats`, 202, token auth only).

Nothing is blocked by this today — LAI-012 ships the skeleton with an empty
`hooks/hooks.json` and no heartbeat code, exactly as its notes instruct.
