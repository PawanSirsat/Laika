---
id: LAI-711
title: 'The Dashboard, the Jira way — simpler, aligned, and work divided by person in a circle'
area: web
assignee: chief
priority: p1
depends-on: [LAI-707]
status: in-progress
started: 2026-10-07T09:11:31Z
---

## Goal

The owner, 2026-10-07, with two screenshots of the Dashboard tab: *"improve
this page properly, I want what Jira uses, simplify everything, and also show
the person-wise task divide in a circle … remove what is not necessary …
alignment is also not properly aligned."*

Today the page has seven panels, several saying the same thing. "Who is
carrying what" counts in-progress tasks only, so 346 tasks read as "2 carrying
work". The Stale count is capped at 5 by a `slice` taken before it. The top
cards overflow their row (`height: 100%` without `border-box`), and the right
rail clips at the window edge. Every range change blanks the page, and the page
never follows the live stream.

## Acceptance criteria

- [ ] Four stat cards for the chosen range: done (the `/metrics` throughput
      sum), updated, created, and due soon (the next 7 days) with overdue.
- [ ] A **Status overview** donut: every status with its count and percent,
      the total in the centre, and percent done beneath it. Lane colours match
      the board, never the accent.
- [ ] A **Work by person** donut of open work per assignee, with Unassigned,
      and "Others" past six people. Every assignee is named, including an org
      owner with no membership row. A legend row opens the board filtered to
      that person.
- [ ] **Needs attention** shows blocked and stale work with their true counts.
      Rows open the task.
- [ ] A priority breakdown, and throughput with cycle time (SPEC §11.4.2.1).
- [ ] The activity feed keeps its All/People/Agents filter and scrolls inside
      its card. Day headings separate the rows.
- [ ] Removed: Release progress (now the donut's centre), "Work by status",
      "Who is carrying what", the Agent log card, and the dead CSS.
- [ ] **Aligned.** At 1280px and 1100px nothing overflows sideways, cards in a
      row share top and bottom edges, and the gutters match the space bar.
      Layout follows the content width, not the window.
- [ ] **No flash.** A range change or a live frame updates the page in place.
      The skeleton shows only on the first load.
- [ ] Charts are hand-written SVG with no dependency, use tokens only, work in
      both themes, and are labelled for screen readers.
- [ ] Browser and unit tests prove each of the above, red against the old code.
- [ ] D-072 records the shape, and SPEC §11.4.2 / §11.4.2.1 match it.

## Notes / context

Plan: pure derivations in `dashboard-derive.ts` (`windowCounts`,
`workloadByPerson`, `priorityBreakdown`), the donut geometry in
`components/donut-arcs.ts`, `components/Donut.tsx`, and panel components
beside `DashboardScreen.tsx`. Names come from `/members` and then
`/mentionable`. Live updates come from `useLive().generation`. Built by CHIEF
on the owner's direct instruction, on `build-dash`.
