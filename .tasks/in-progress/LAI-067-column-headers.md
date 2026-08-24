---
id: LAI-067
title: Column headers — status dots and WIP limits
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-049]
discovered-from:
status: in-progress
started: 2026-08-25T08:40:00+05:30
---

## Goal

The prototype's columns carry a coloured status dot beside each name, and
IN PROGRESS shows `WIP 3/4`.

## Acceptance criteria

- [ ] A status dot per column, colour-mapped from the tokens — `--tx3` backlog,
      `--pur` to-do, `--acc` in progress, `--amb` review, `--grn` done.
- [ ] Counts stay as they are; they already come from real data.
- [ ] Both themes.

## Explicitly NOT in this task

**The WIP limit.** There is no WIP-limit column on `projects` and nothing in
SPEC §4 defines one, so `3/4` is a mockup fixture. A hardcoded denominator is a
defect. If WIP limits are wanted they need a spec decision and a column first —
say so in your log and I will file it.
