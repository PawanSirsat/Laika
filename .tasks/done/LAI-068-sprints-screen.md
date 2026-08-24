---
id: LAI-068
title: Sprints screen — list, create, activate, and assign work
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-050, LAI-058]
discovered-from:
status: done
---

## Goal

`/sprints` is a placeholder reading *"No sprints yet"*. **The whole API landed
with LAI-050** — CRUD, activation, task assignment, non-overlap and the
one-active rule, all enforced server-side and well tested.

D-013: sprints carry **dates and a goal, no estimation**. If a control here
implies velocity or story points, it does not belong.

## Acceptance criteria

- [ ] List a project's sprints from `GET /api/v1/projects/:slug/sprints`, with
      status, date range and goal.
- [ ] Create one via `POST` to the same path.
- [ ] Edit and delete via `PATCH`/`DELETE /api/v1/sprints/:id`.
- [ ] Activate a sprint. **A second activation returns 409** — surface the
      server's message, which names the sprint already holding it, rather than a
      generic failure.
- [ ] **Overlapping dates return 409** naming the sprint they collide with —
      show that too. Do not reimplement the overlap rule client-side; the server
      owns it and will always be the one that decides.
- [ ] `ends_on` is **inclusive** and the shortest sprint is two days — the date
      inputs must not imply otherwise.
- [ ] Assign tasks in and out (`POST /api/v1/sprints/:id/tasks`,
      `DELETE .../tasks/:taskId`). Bulk assignment is **all-or-nothing**: on
      rejection, show that nothing was applied.
- [ ] Deleting a sprint **does not delete its tasks** — they return to
      unassigned. Say so before confirming; a delete that looks like it might
      take the work with it will not get used.
- [ ] `lead`+ for create/edit/delete, `member`+ for assignment; no enabled
      control that 403s.
- [ ] Both themes.

## Notes / context

**Read `server/src/services/sprints.ts` first.** The rules and their reasons are
written at the top, including why `ends_on` is inclusive.

The prototype's sprint chips show `11/11`, `13/14` — done-over-total counts.
Derive those from the tasks in each sprint; do not hardcode.

## Closed as superseded — PM, 2026-08-25

**Duplicate of LAI-083**, which is the same screen assigned to Builder-A under
D-028. This one predates that decision and was still `unclaimed` in `web`, so it
was the highest-priority claimable item in Builder-B's area — meaning the next
`/claim` would legitimately have started a second build of one screen in a
directory only one session may edit.

**Builder-B spotted it and did not claim it**, which is exactly right: a
duplicate is PM's to close, not a builder's to quietly avoid.

My error: I filed LAI-083 without checking the backlog for the screen I had
already specified two days earlier. LAI-083 carries the criteria.
