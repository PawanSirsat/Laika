---
id: LAI-282
title: Re-import the updated prototype — docs/design/ is stale
area: docs
assignee: unclaimed
status: backlog
priority: p1
depends-on: []
discovered-from: LAI-281
---

## What

The owner updated the Claude Design prototype on 2026-09-18:

- The board's right rail is gone — the board is plain columns.
- Its three panels are a new **Activity** tab between Dashboard and Meeting
  review: *Live stream* · *Agent sessions* · *Stale · no movement*.

`docs/design/Laika Prototype.dc.html` is the copy imported before that change.
It still draws the rail inside `boardLive` and has an eight-tab strip with no
Activity. **Every task in the design pass cites line numbers in that file**, and
they now describe a design that no longer exists.

Source: `claude.ai/design/p/a931b00e-ce58-4723-9699-b7cb2f1567e9?file=Laika+Prototype.dc.html`

## Why SHELL filed it rather than doing it

`docs/` is CHIEF's (§1), and the import is a whole-file replacement of the
canonical reference — not a change a builder should make from a branch.

## Notes for whoever takes it

SHELL could not read the updated design from this session. `DesignSync` answers
*"needs design-system authorization — run `/design-login`"*, which only the owner
can run, and that tool reads design-**system** projects; this prototype is a
regular design project and may not be reachable through it at all. LAI-281 was
built from the owner's screenshots instead, and matches them.

`docs/design/README.md` is already stale for a second reason (LAI-253): its
token table and its sidebar section predate D-059. Worth doing both at once.

## Acceptance criteria

- [ ] `docs/design/Laika Prototype.dc.html` is the current export, and the
      per-screen files beside it either match or are marked superseded.
- [ ] The new Activity screen's line range is recorded, so tasks can cite it.
- [ ] `docs/design/GAPS.md` notes which earlier task files cite line numbers
      from the superseded copy — LAI-256, 273, 274, 275, 277, 278, 279 all do.
