---
id: LAI-097
title: A task cannot be assigned to anyone from the UI
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-056, LAI-060]
discovered-from:
status: in-progress
started: 2026-08-25T07:00:00+05:30
---

## Goal

**The whole multi-user chain works in the API and stops at the screen.**

`PATCH /api/v1/tasks/:id` accepts `assignee_id`, gated by `task.assign_other`
(member+, §3.2, enforced at `services/tasks.ts:275`). `GET /api/v1/users` lists
who is available. `?assignee=` filters the board. `POST /tasks/:id/claim` is a
compare-and-swap self-claim.

**None of it is reachable.** The board card and the task detail both render
`unassigned` as **plain text**. There is no picker, no menu, no claim button. A
team can be invited, added to a project and given roles — and then nobody can be
given a task.

## Acceptance criteria

- [ ] Assign a task from the task detail, choosing from the project's members —
      **not the whole org**. `GET /users` is org-wide and a task is
      project-scoped; offering someone who cannot see the project creates an
      assignee who cannot open their own work.
- [ ] Unassign — back to `null`, which is the ordinary state and not an error.
- [ ] **Claim** — a one-click self-assign via `POST /tasks/:id/claim`, because
      that is the common case and it is the endpoint with the compare-and-swap.
- [ ] **A losing claim is 409 with the current assignee in the body — show who
      won.** *"Taken by Sana a moment ago"* is the whole point of the
      compare-and-swap; a generic failure throws that away.
- [ ] Assignment shows on the **card**, not only in the detail — an avatar, as
      the design draws it. Whose work it is, is the thing you scan a board for.
- [ ] A Viewer sees assignment and gets no control (`task.assign_other` is
      member+).
- [ ] Both themes.

## Notes / context

**Do not reimplement the claim race client-side.** The server does
compare-and-swap under a write lock; the client's job is to send the request and
render whichever answer comes back. Same rule as the sprint 409s in LAI-083.

**Not in scope: reassigning by dragging onto an avatar.** Get the plain control
working first.

Related gap, filed separately: **an invite cannot be created from the UI** either
— the API landed with LAI-071, but the screen that would use it is the
Organisation screen (**LAI-086**). So today a second person can join only if
someone mints the invite by hand against the API.
