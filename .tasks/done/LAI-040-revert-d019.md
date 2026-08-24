---
id: LAI-040
title: Revert D-019 — restore the prototype's --tx3 and bar PM from design tokens
area: docs
assignee: pm
priority: p1
depends-on: []
discovered-from:
status: done
started: 2026-08-24T05:55:00+05:30
finished: 2026-08-24T06:00:00+05:30
reviewed: 2026-08-24T06:00:00+05:30
---

## Goal

Part 1 of the owner-approved standards plan. PM had darkened `--tx3` in both
themes (D-019), edited `docs/design/README.md` and filed LAI-035 — all
self-approved. `docs/design/` is the owner's imported visual reference; changing
it was not PM's decision. The owner asked for a full revert.

## Acceptance criteria

- [x] `docs/design/README.md` restored to the prototype's `--tx3`: light
      `#8d94a4`, dark `#71717d`; the contrast-rules section removed.
- [x] **D-020** appended, superseding D-019 and recording that the measurements
      stand while the decision was not PM's to make.
- [x] D-019 marked `REVERTED — superseded by D-020`.
- [x] LAI-035 closed **unapplied**, not done.
- [x] The measurements survive as **LAI-041**, for the owner.
- [x] `CLAUDE.md` §1: **PM never changes a design token.**
- [x] Verified nothing reached code — `tokens.css` still holds the prototype
      values.

## Resolution — PM, 2026-08-24

Completed in full at 06:00; see **D-020** for the reasoning and
`logs/pm-2026-08-24.md` for the session record.

**This file was created late, and that is itself the finding.** The work was done
and committed as `docs(design): revert D-019 … [LAI-040]`, but the task file was
never written — the plan named LAI-040 and I went straight to the work. The
commit therefore cited a task id that existed nowhere, which is exactly the
dangling-reference class D-011 was written to prevent, committed by the person
who wrote D-011.

Caught while checking the standards plan's completion. Recorded as done rather
than left as a gap, so the commit reference resolves and the id is not reused
(D-017).
