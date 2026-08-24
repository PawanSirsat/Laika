---
id: LAI-083
title: Sprints screen — the API has been complete and unused
area: web
assignee: builder-a
priority: p1
depends-on: [LAI-082]
discovered-from:
finished: 2026-08-24T19:40:31Z
reviewed: 2026-08-25T14:30:00+05:30
started: 2026-08-24T19:21:35Z
status: done
---

## Goal

**You built this API and nothing consumes it.** LAI-050 shipped CRUD,
activation, assignment, non-overlap and the one-active rule, all tested under
concurrency. `/sprints` renders "No sprints yet".

**Yours under D-028** — work only in `server/web/src/routes/screens/sprints/`.
Do not touch `route-table.ts`, `Sidebar.tsx` or anything else under
`server/web/`; LAI-082 has already registered the route and shell for you.

## Acceptance criteria

- [x] List a project's sprints from `GET /api/v1/projects/:slug/sprints` — name,
      status, date range, goal.
- [x] Create, edit and delete (`POST`, `PATCH`/`DELETE /api/v1/sprints/:id`).
- [x] Activate. **A second activation is 409** — surface the server's message,
      which already names the sprint holding it.
- [x] **Overlap is 409** naming the collision. Do not reimplement the rule
      client-side; the server owns it and will always be the one that decides.
- [x] `ends_on` is **inclusive** and the shortest sprint is two days — the date
      inputs must not imply otherwise.
- [x] Assign tasks in and out. Bulk assign is **all-or-nothing**: on rejection
      show that nothing was applied.
- [x] Deleting a sprint **does not delete its tasks** — say so before confirming.
- [x] Progress per sprint (done/total) derived from real tasks. No fixtures.
- [x] `lead+` for create/edit/delete, `member+` for assignment — no enabled
      control that 403s.
- [x] Both themes, tokens from `docs/design/README.md`, **driven through the real
      theme control** when you check.

## Notes / context

**This is your first UI task — read `server/web/src/routes/screens/board/` first**
for how a screen is structured, how `api/` hooks are written, and how states are
rendered. Follow it rather than inventing a second style.

Style from `docs/design/`, never markup. Every number from the API.


---

## Builder-A notes (2026-08-25)

### Verified against the built app, in a browser, both themes

Signed in as a real Owner, real org, real project, seven real tasks, two real
sprints. Every number on screen came from an API response.

| Checked | Result |
| --- | --- |
| List | `M2 — Two humans` active, `6 Aug – 19 Aug 2026`, **14 days**, `2/4 done` |
| Second activation | `Sprint "M2 — Two humans" is already active` — the server's words |
| Overlap | `Those dates overlap sprint "M2 — Two humans"` — the server's words |
| Inclusive end | `10 Aug` – `17 Aug` renders **"8 days, last day included."** |
| Delete | tasks survived: all 7 still in the project, `sprint_id: null` |
| Assignment | 3 selected → `Tasks (3)`, `0/3 done`, panel drops them from the offer |
| Themes | driven through the **real radios**, not `.dk`. Both clean. |

### The rules are the server's, and there is a test that keeps it that way

Neither 409 is predicted client-side. `sprint-derive.ts` validates only what is
true of one sprint in isolation — a name, two parseable dates, the two-day
minimum the `CHECK` constraint imposes — and a **structural test** greps every
file in this folder for a local overlap or one-active check and fails if one
appears. A client-side copy of those rules is wrong exactly when two people plan
at once, which is the case the server takes a write lock for.

### `ends_on` is inclusive, and the UI says so three times

The field is labelled **"Last day"**, not "End date". The live hint counts
inclusively (`1st`–`14th` → "14 days"). The empty-form hint states the two-day
minimum outright rather than waiting for a rejection. `sprintDays`'s `+ 1` has
its own test, and removing it fails three.

### Decisions a reviewer might have made differently

- **One task request for the whole screen**, grouped locally, rather than
  `?sprint=` per sprint. The screen needs every sprint's counts *and* the
  unassigned list on one render, so per-sprint requests would be one per row
  plus another for the leftovers. Both lists walk their cursor; hitting the page
  cap sets `truncated` and the screen says so rather than showing a confidently
  low count.
- **`cancelled` counts in neither half of progress.** Leaving it in the
  denominator holds a finished sprint below 100% for ever. This is the one
  judgement call in `sprint-derive.ts` and it has a test either way.
- **Two permission helpers, not one.** `sprint.manage` is lead-only but
  `task.assign_sprint` is member+ (§3.2). Collapsing them would silently hide
  assignment from every Member, which is the more common role on a real board.
- **Controls are hidden, not disabled.** A disabled Activate still tells a
  Member that activation is something they are failing at.

### Filed, not fixed

- **LAI-121** — `api/tasks.ts`'s `Task` has never declared `sprint_id`, though
  the server has returned it since LAI-011; the board just never read it.
  Declared locally in `sprint-derive.ts` with a **checked read**, not a cast, so
  a server that stopped sending it degrades to "no sprint". Builder-B confirmed
  the field independently and we agreed to keep it a separate task rather than
  move the type under this screen mid-flight.
- **LAI-122** — the sidebar sprint count goes stale after a delete until reload.
  Reproduced on the built app. `use-shell-context.ts` is Builder-B's.

### Not done

`?tag=`-style filtering and a sprint burndown are not in the ACs and are not
here. 12 break-probes across the derive module and the API client; all 12 fail
when broken.

## Review — PM, 2026-08-25

**Accepted. The sprints API has a screen — this is the second real screen in the
product.** Rendered with a real owner, org, project, four tasks and two sprints,
both themes through the real radios. `M2 — Two humans`, `6 Aug – 19 Aug 2026`,
**14 days**, PLANNED chip, progress bar, working Activate/Edit/Delete/Add tasks.

**I clicked Activate twice.** The second attempt renders **`Sprint "M2 — Two
humans" is already active`** — your server's own words, naming the holder, with a
Dismiss. Creating an overlapping sprint returns 409 from the API. Neither rule is
predicted client-side.

**The structural guard is the best thing here.** `nothing in the sprints folder
mentions overlap or one-active` greps the whole folder and fails if someone adds
the pre-check — and the comment says why: *"a client-side copy is wrong exactly
when two people plan at once."* A comment would have been ignored by the next
session; a failing test cannot be. Same instinct as `validateSprintForm`'s
*"does not attempt to check overlap — the server owns that"*.

**Stating inclusivity three times is right, not redundant.** "Last day" as the
field label, the live inclusive count, and the two-day minimum given up front
rather than as a rejection. `ends_on` inclusive is undocumented in §4.15 and
invisible until someone is off by one.

Boundary clean under D-028 — nothing outside your three screen folders and
`api/sprints.ts`.
