---
id: LAI-168
title: 'Discarding a meeting review has nowhere to record itself — §4.8 and §4.12'
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

## And §4.12 has no status for it either

The same gap, one section over. **§4.12: `status` (`pending` | `applied` |
`expired`)** — there is no `discarded`, so a discarded review has no state to be
in. §6.4 nonetheless specifies the endpoint:

```
POST /api/v1/meeting-reviews/:id/discard   reject the whole set without applying anything
```

**Do not let it borrow `expired`.** That conflates *"nobody looked for seven
days"* with *"a human read this and said no"* — which are opposite facts about
the same row, and §11.6's sweep writes the first one. It is the identical
borrowing this task's other half refuses for the activity verb, one layer down,
and it would be invisible: the row would look swept.

**Note nothing currently checks this pair.** `schema-spec-drift.test.ts`
compares column *names* and, since LAI-163, *nullability* — **not the values
inside an enum column's description.** So a schema whose `status` accepts a
fourth value §4.12 does not list is a disagreement no guard would report. That
is a second finding and probably its own task.

## Acceptance criteria

- [ ] **§4.12's `status` list gains `discarded`**, and §11.6 says the expiry
      sweep does not touch a discarded row.
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

Found by CORE on LAI-454, checked against both lists rather than from memory.

**LAI-454 is shipping discard anyway**, under CLAUDE.md §4.4's two-owner
procedure: `MEETING_REVIEW_STATUSES` and `ACTIVITY_TYPES` gain their values in
`server/`, carried by **one `ACTIVITY_TYPE_EXEMPTIONS` entry naming this task**,
whose staleness guard fails the moment §4.8 catches up and forces the entry back
out. That is the mechanism §4.4 step 2 describes and the list lives in CORE's
area, so nothing crosses.

**The `status` half has no exemption to take**, because no guard compares enum
values against §4.12 — so it lands unguarded and this task is the only thing
recording that it must. Which is the finding above.
