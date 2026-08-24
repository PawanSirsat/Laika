---
id: LAI-097
title: A task cannot be assigned to anyone from the UI
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-056, LAI-060]
discovered-from:
status: done
started: 2026-08-25T07:00:00+05:30
finished: 2026-08-25T07:30:00+05:30
reviewed: 2026-08-26T01:45:00+05:30
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

- [x] Assign a task from the task detail, choosing from the project's members —
      **not the whole org**. `GET /users` is org-wide and a task is
      project-scoped; offering someone who cannot see the project creates an
      assignee who cannot open their own work.
- [x] Unassign — back to `null`, which is the ordinary state and not an error.
- [x] **Claim** — a one-click self-assign via `POST /tasks/:id/claim`, because
      that is the common case and it is the endpoint with the compare-and-swap.
- [x] **A losing claim is 409 with the current assignee in the body — show who
      won.** *"Taken by Sana a moment ago"* is the whole point of the
      compare-and-swap; a generic failure throws that away.
- [x] Assignment shows on the **card**, not only in the detail — an avatar, as
      the design draws it. Whose work it is, is the thing you scan a board for.
- [x] A Viewer sees assignment and gets no control (`task.assign_other` is
      member+).
- [x] Both themes.

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

## Notes at review — builder-b

### Verified live, including the race

| criterion | evidence |
| --- | --- |
| assign from **project** members | picker offered `unassigned · Ada Lovelace (you) · Sana Verma` — the two project members, **not** the org list |
| unassign | back to `unassigned`, Claim reappears |
| claim | one click, self-assign via the compare-and-swap endpoint |
| **losing claim names the winner** | another actor took it first, then Claim → **"Taken by Sana Verma first."**, and the picker corrected itself to Sana |
| avatar on the card | card avatar followed the assignment without a reload |
| Viewer | no picker, no Claim, static name only — and the same `PATCH` answers **403** |
| both themes | control, Claim and the error line all invert |

The losing-claim case was tested by having a **second actor win the race first**,
not by mocking — that is the one criterion that cannot be trusted to a unit test,
because the whole point is what the server puts in the 409 body.

### The race stays on the server

`claimTask` sends the request and renders whichever answer comes back.
`claimWinner()` only *reads* `details.assignee_id` out of a conflict; it never
decides anything. Nothing here re-implements the compare-and-swap, per the task
and the same rule as the sprint 409s in LAI-083.

### A Viewer gets no control, not a disabled one

`mayAssign` false renders the plain name. A disabled select says "you could do
this", and a 403 on click says the app is broken rather than that they lack
permission.

### Worth knowing

**Claim also moves the task to `in_progress` and sets `started_at`** — it is not
purely an assignment. That is the server's behaviour (`services/tasks.ts`), and
it is the right one for "I am picking this up", but it means Claim and choosing
yourself from the picker are **not** equivalent. The picker assigns without
moving the task. I left both because they mean different things.

### Not in scope, and still true

**An invite cannot be created from the UI.** The API landed with LAI-071 and the
screen that would use it is LAI-086. So a second person still joins only if
somebody mints an invite by hand against the API — which is what made testing
this task need a hand-seeded second member.

## Review — PM, 2026-08-26

**Accepted. A task can be given to a person from the UI** — which it could not be
since LAI-011 shipped the endpoint. I clicked Claim in a browser and the task
came back assigned.

**`claimWinner` reads the winner out of a losing 409** rather than predicting the
race. That was the criterion I cared most about: the server does a genuine
compare-and-swap under a write lock, and *"taken by Sana a moment ago"* is the
whole reason it is worth doing there. A generic failure would have thrown that
away.

The picker offers **project members, not the whole org** — `GET /users` is
org-wide and a task is project-scoped, so the wider list would create an assignee
who cannot open their own work.

Unassign back to `null` treated as the ordinary state, not an error.
