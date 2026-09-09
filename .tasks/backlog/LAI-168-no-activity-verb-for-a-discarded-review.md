---
id: LAI-168
title: '§4.8 has no verb for discarding a meeting review'
area: docs
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-454
status: backlog
---

## Goal

**LAI-454's AC8 instructs the builder to stop and file, and this is that filing.**

> `discard` writes an activity row. If §4.8 has no verb for it, **stop and
> file** — do not borrow `meeting.applied` for a discard.

**It has none.** §4.8's list is 36 verbs and carries `meeting.applied` and
`meeting_review.expired`; `server/src/db/enums.ts` matches it exactly, which
`schema-spec-drift.test.ts` enforces in both directions. Checked against the
list, not from memory.

So `POST /meeting-reviews/:id/discard` currently has nowhere to record that a
human threw a proposal set away.

## Why it wants a verb rather than a payload flag

This is the §4.8 argument that already ran once and was settled the same way.
**`unlisted.dismissed` exists** — dismissing a note off the unlisted pile got its
own verb rather than filing under `unlisted.logged`, and §4.8 records why:

> Promote and dismiss under `unlisted.logged` … Each was a recorded compromise;
> four of them is the vocabulary being wrong (LAI-113, LAI-222).
>
> **The test is the one `project.archived` already passed:** could a reader
> answer *"when did this happen?"* without inspecting a payload?

*"When was that meeting's proposals thrown away, and by whom?"* fails that test
today, and a discard is the same shape as a dismiss: a human declining a
machine's suggestion, which is the event worth keeping.

**It is also the negative half of the human gate.** §10.2's promise is *"Nothing
applies without explicit human acceptance"*; the audit trail records the
acceptances and would be silent on the rejections, so the table would show only
the times somebody said yes.

## Acceptance criteria

- [ ] §4.8's type list gains a verb for it — `meeting.discarded` unless there is
      a better name — with the payload it carries.
- [ ] The server half lands with it: `ACTIVITY_TYPES` in
      `server/src/db/enums.ts`, and the `activity_type_check` constraint that
      follows from it. **This is CLAUDE.md §4.4's two-owner shape** — the SPEC
      row and the enum each fail the drift check alone — so co-ordinate the
      merge rather than landing either half on `origin/master`.
- [ ] `discard` writes the row, and a test asserts a reader can answer *"who
      discarded this set and when"* without reading a payload.

## Notes

Found by CORE on LAI-454, which is being built without the activity row and will
come back with its AC8 unticked and this task named — exactly as that criterion
asks.
