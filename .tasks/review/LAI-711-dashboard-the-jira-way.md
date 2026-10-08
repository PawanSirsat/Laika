---
id: LAI-711
title: 'The Dashboard, the Jira way — simpler, aligned, and work divided by person in a circle'
area: web
assignee: chief
priority: p1
depends-on: [LAI-707]
status: review
started: 2026-10-07T09:11:31Z
finished: 2026-10-08T06:36:21Z
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

- [x] Four stat cards for the chosen range: done (the `/metrics` throughput
      sum), updated, created, and due soon (the next 7 days) with overdue.
- [x] A **Status overview** donut: every status with its count and percent,
      the total in the centre, and percent done beneath it. Lane colours match
      the board, never the accent.
- [x] A **Work by person** donut of open work per assignee, with Unassigned,
      and "Others" past six people. Every assignee is named, including an org
      owner with no membership row. A legend row opens the board filtered to
      that person.
- [x] **Needs attention** shows blocked and stale work with their true counts.
      Rows open the task.
- [x] A priority breakdown, and throughput with cycle time (SPEC §11.4.2.1).
- [x] The activity feed keeps its All/People/Agents filter and scrolls inside
      its card. Day headings separate the rows.
- [x] Removed: Release progress (now the donut's centre), "Work by status",
      "Who is carrying what", the Agent log card, and the dead CSS.
- [x] **Aligned.** At 1280px and 1100px nothing overflows sideways, cards in a
      row share top and bottom edges, and the gutters match the space bar.
      Layout follows the content width, not the window.
- [x] **No flash.** A range change or a live frame updates the page in place.
      The skeleton shows only on the first load.
- [x] Charts are hand-written SVG with no dependency, use tokens only, work in
      both themes, and are labelled for screen readers.
- [x] Browser and unit tests prove each of the above, red against the old code.
- [x] D-072 records the shape, and SPEC §11.4.2 / §11.4.2.1 match it.

## Notes / context

Plan: pure derivations in `dashboard-derive.ts` (`windowCounts`,
`workloadByPerson`, `priorityBreakdown`), the donut geometry in
`components/donut-arcs.ts`, `components/Donut.tsx`, and panel components
beside `DashboardScreen.tsx`. Names come from `/members` and then
`/mentionable`. Live updates come from `useLive().generation`. Built by CHIEF
on the owner's direct instruction, on `build-dash`.

## Delivery notes

- **The summary arithmetic is in a sibling module, `summary-derive.ts`, not in
  `dashboard-derive.ts`.** That module's tests pin the feed vocabulary and the
  blocked rule; how open work divides up is a different concern.
- **One glide-free chart component**, `components/Donut.tsx`, drawn as
  `pathLength=100` circles. The geometry and largest-remainder percentages live
  in `donut-arcs.ts`, so legends always add to 100. A non-zero share that
  rounds to nothing reads `<1%`.
- **People slices are coloured by rank, not by avatar hue.** The avatar still
  sits beside each swatch.
- **The space bar's task filters are claimed away on the dashboard**
  (`useClaimSpaceFilters`). They did nothing here.
- **Throughput, cycle time and done now share one in-place-refreshing metrics
  state in `use-dashboard.ts`.** All time sums done from the task list, because
  `/metrics` answers its own 30 days.
- **Incident, recorded rather than hidden.** The owner interrupted the first
  red-first run mid-swap, which left master's old `DashboardScreen.tsx`,
  `dashboard.css` and `use-dashboard.ts` on disk. Caught the next day because
  `git status` showed them unmodified. They were restored from the copies saved
  before the swap, and every final change was verified present. The red-first
  run was repeated with a trap restore: all ten browser tests fail against
  master's code.
- **Gate.** test, lint and format each exited 0. Server 2099, web 1333,
  cli 85.
