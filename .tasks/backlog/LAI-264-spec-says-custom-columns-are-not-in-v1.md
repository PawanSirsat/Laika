---
id: LAI-264
title: 'SPEC says custom columns are not in v1, and they now are'
area: docs
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-266
status: backlog
---

## Goal

**§11.4.1 currently forbids the feature the owner has asked for**, and LAI-266 is
building it. Two sentences have to change, and they are CHIEF's — a builder
cannot touch `docs/`.

Verbatim, `docs/SPEC.md` §11.4.1:

> **Explicitly not in v1:** swimlanes, WIP limits, custom columns, saved views,
> bulk edit. **Columns are the status enum; when that is not enough, use the
> list.**

and, a few lines above it:

> - Column order and the `ready` marker are both **derived** — never stored,
>   never cached client-side beyond the current response.

Both are now false. Columns are rows in `board_columns`, their order is stored
in `position`, and a column is a named grouping of statuses rather than a status.

A third sentence in the same section is falsified by LAI-266's other half:

> Dragging a card between columns issues `POST /api/v1/tasks/:id/status` and is
> **subject to the same transition validation as any other caller (§5)**

It is not, after LAI-266: a person dragging gets a widened transition table and a
token-bearing agent does not. **The same CHIEF edit carries all three**, which is
why this is one task and not three.

## What is wanted

1. **§11.4.1 amended** — columns are per-project configuration; order is stored;
   drop the "custom columns" clause from the not-in-v1 list; correct the
   drag-validation sentence to name the interactive/agent split.
2. **§5 needs no change, and that is worth confirming rather than assuming.** It
   draws the forward path and states constraints; it never enumerates the
   matrix — `ALLOWED_TRANSITIONS`'s own docblock says so (*"does not enumerate
   the reverse edges a real board needs"*). Its two load-bearing sentences both
   survive: the `review` gate, and *"`done` is never set by `finish_task`.
   Agents do not self-certify."* **Please read it and confirm, or amend it.**
3. **§4 gains two table sections** — `board_columns` and
   `board_column_statuses` — and one column on §4.3 `projects`
   (`board_hide_done_days`). §4 currently runs to `### 4.19`, so 4.20 and 4.21
   are the next free numbers. `schema-spec-drift.test.ts` reads these tables as
   schema declarations, so getting the field list right is load-bearing.
4. **A `DECISIONS.md` entry** recording that columns became configuration and why
   the transition table split by principal.

## Acceptance criteria

- [ ] §11.4.1 no longer lists custom columns as out of v1, no longer says column
      order is derived, and describes the drag-validation split accurately.
- [ ] §4.20 and §4.21 describe the two tables, and §4.3 carries
      `board_hide_done_days`.
- [ ] §5 is either confirmed unchanged in the review note, or amended.
- [ ] A `DECISIONS.md` entry exists.
- [ ] After this lands, the two `TABLES_NOT_IN_SPEC` entries LAI-266 took are
      **removed** and `schema-spec-drift.test.ts` is green. That test fails on
      purpose until they are — *"exempted, but it is no longer an undocumented
      table; remove the entry"* — so this criterion cannot be ticked by accident.

## Notes / context

**Filed before any code landed**, deliberately, so CHIEF is not asked to
rubber-stamp a finished thing. CLAUDE.md §4.4 is the governing procedure and this
is its two-owner form: the owner granted LAI-266 both the server and web halves,
so there are two parties here, CHIEF and SHELL, not three.

The owner's instruction that produced this: *"i wnat make board dynamic also we
cam crate new one or dlete when wher eis new we will gave 4 by deaulft then also
we can change the seque by drag and drop also do setting like jira"*.

**LAI-267 and LAI-268 are unblocked by LAI-266** — both say *"there is no column
table"* and both want configuration hung off one. Worth noting when §4.20 is
written, because `wip_limit` and `reviewer_id` will land on that table.
