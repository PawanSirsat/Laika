---
id: LAI-276
title: PresencePerson's `row` variant has no caller
area: web
assignee: unclaimed
status: backlog
priority: p3
depends-on: []
discovered-from: LAI-275
---

## What

`PresencePerson` was built as the one renderer for a presence entry (LAI-440),
with two variants: `chip` for the board's WORKING NOW strip and `row` for
Capacity's list. LAI-275 rebuilt Capacity to the design's four-panel card, whose
identity column is not a presence row — the repo and branch belong in the
WORKING ON panel, not beside the name — so the `row` variant lost its only
caller.

`grep -rn 'variant="row"' src/ test/` returns nothing.

## Why it is a task and not a deletion

Deleting it means touching `PresencePerson` and its tests during a screen-by-
screen design pass, which is exactly the widening the discovery rule exists to
prevent. It is dead weight, not a defect, and it costs one commit to remove
cleanly.

## Acceptance criteria

- [ ] Either the `row` variant and its styles are removed and `variant` stops
      being a prop, or a caller is named in this file and the variant stays.
- [ ] `PresencePerson`'s tests still assert the chip's three shared decisions
      (whether a location may be shown, what to say when it may not, how an
      agent is marked) — those are the reason the component exists.
- [ ] Full gate.
