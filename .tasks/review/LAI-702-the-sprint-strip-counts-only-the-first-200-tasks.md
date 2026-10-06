---
id: LAI-702
title: 'The sprint strip counts only the first 200 tasks, so a sprint reads 7/42 when it holds 157'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-701
status: review
started: 2026-10-06T12:26:13Z
finished: 2026-10-06T12:30:15Z
---

## Goal

The owner selected sprint S3 on the Onroute board and saw the chip read
**7/42** while the board under it showed **149 in Review and 7 Done**:
*"I don't understand the logic."* The board is right and the strip is wrong.
The strip's per-sprint counts must be of the whole project, as its own comment
already claims they are.

## What was measured (production, read-only, 2026-10-06)

`BoardScreen.tsx` feeds `SprintStrip` from `listTasks(slug, { limit: 200 })` —
**one page**, ordered oldest-updated first. Onroute has **328** tasks, so the
strip counts the 200 least-recently-touched and never sees the rest. The board
itself uses `fetchEveryPage`, so its lanes are complete.

| sprint | real done / total | strip shows |
| --- | --- | --- |
| S3 · P1 close-out + Criticals | 7 / 157 (149 review, 1 cancelled) | 7 / 42 |
| S4 · P2 Payment capture | 0 / 54 | 0 / 49 |
| S1, S2, S5–S8 | equal | equal |

S3 is the worst because its 149 tasks were all moved to Review recently, which
puts them last in that order. `DONE`, `BLK` and the progress bar on every chip
come from the same truncated list.

## Acceptance criteria

- [x] The strip counts every task in the project: the chips' `done/total`,
      the bar, and the `DONE` / `BLK` summary, for a project with more than
      one page of tasks.
- [x] A browser test serves two pages of tasks (the second carrying tasks of
      the selected sprint) and asserts the chip and the summary count both
      pages — red against the current single request.
- [x] The strip and the board cannot disagree on a sprint's total when the
      board is scoped to that sprint and no other filter is set.
- [x] Both themes; the gate exits 0 on all three.

## Notes / context

Simplest fix: load the strip's list with `fetchEveryPage` (`api/use-board.ts`)
instead of one page. The better one: the server already computes per-sprint
counts in `sprintTaskCounts` (`services/sprints.ts`, used by MCP
`list_sprints`); serving them on `GET /projects/:slug/sprints` would replace a
whole-project download with one query, but it is a CORE half plus a client
half and `BLK` needs readiness, which is not a status count. Start with the
client fix; file the server one if the download is slow.

## Built — CHIEF, 2026-10-06

`api/every-page.ts` (+ unit test) reads a paged list to the end and reports
`truncated` at a cap of 25 pages; the strip's list goes through it, and a `+`
with a title marks the DONE figure when the cap is hit. Browser tests: page
two carries three S3 tasks in Review and the chip and DONE read **1/5** (they
read 1/2 before — the red run is the pre-fix code); an endless list shows the
partial marker. Mutation: the helper stopping after page one turns two unit
tests red. The other screens with the same defect are LAI-703; the agents'
tools are LAI-704.
