---
id: LAI-1047
title: Record public deployment metadata as the third can() exception (D-123)
area: docs
assignee: chief
status: review
started: 2026-11-02T00:00:00Z
finished: 2026-11-02T00:00:00Z
priority: p1
depends-on: []
discovered-from: LAI-1043
---

## Why
Review of LAI-1043 (PR #200): `/health` and the new `/developer/compatibility` skip
`can()` without matching either named CLAUDE.md §5 exception.

## Acceptance criteria
- [x] CLAUDE.md §5 names a third case with its conditions and both instances.
- [x] docs/DECISIONS.md records D-123.
