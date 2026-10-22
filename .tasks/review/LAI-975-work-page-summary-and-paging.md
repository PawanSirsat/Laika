---
id: LAI-975
title: 'The Work page is one long list with no header, figures or pages'
area: web
assignee: shell
priority: p1
depends-on: [LAI-974, LAI-952]
discovered-from:
started: 2026-10-22T16:37:12Z
status: review
finished: 2026-10-22T16:59:43Z
---

## Goal

The owner (2026-10-22, screenshot of /work): same header as the other pages
(Inbox's), a short analytics strip on top, filters over everyone, and
pagination with counts — **good and minimal**.

## Acceptance criteria

- [x] Header matches the shell's other page headers (Inbox / review
      screen's structure, title, sub-line and spacing) — reuse the shared
      header component, no one-off.
- [x] A compact summary strip under the header from
      `GET /api/v1/tasks/summary` with the **current filters**: total, and
      status counts as small tiles (In progress, Review, To do, Backlog,
      Done), plus Overdue and Blocked when non-zero; clicking a tile sets the
      status filter (and clears it on second click). An owner/admin sees a
      short "by person" row (top people with counts; click filters to that
      person). Figures only from the server; no client counting.
- [x] Pagination: page size 25 by default (25 / 50 / 100 choice remembered
      in the URL), footer *"1–25 of 142"* with previous / next (keyboard
      reachable), built on `next_cursor` with a client cursor stack for
      previous; the page resets to 1 when a filter changes; "Load more"
      removed.
- [x] Minimal: no new colours; design tokens only; both themes; 1440 and
      390 (strip wraps, no sideways scroll); loading and empty states for the
      strip.
- [x] Browser tests (pinned clock if dates shown): counts render from a
      fixture, tile click filters, page 2 then previous returns page 1 rows,
      count text correct at the last page, member sees no "by person" row.
- [x] Gate exit 0 on a branch with LAI-974 merged (endpoint coverage green).

## Builder notes (SHELL, 2026-10-22)

- **The summary is asked with every filter but the status** (`summaryFilter`
  in `work-derive.ts`). The tiles *are* the status breakdown: sending the
  status would zero every other tile and leave nothing to switch to. The
  chosen tile is pressed instead, and the pager's total is
  `by_status[status]`. CHIEF agreed this on dispatch.
- The summary never receives a paging key (`limit`, `cursor`, `fields` —
  LAI-974 answers those `422`); `getTasksSummary` sets only project / status
  / assignee / sprint.
- `by_assignee` is drawn as the server ranks and folds it (top ten, then
  `others`); *Others* is a figure, not a button, and sets no filter.
- The "by person" row is shown to `org_role` owner and admin.
- Capacity's `Tile` is private to its screen; extracting a shared component
  would edit Capacity, outside this task, so the strip matches its tokens at a
  smaller size instead.

### Expected red, §4.4 — retired by CORE at integration

Pairing `TasksSummary` with `TaskCountsView` in `view-type-drift.test.ts`
makes LAI-974's `UNPAIRED` entry stale. `server/` is CORE's, so it is not
edited here. `server/test/tooling/response-type-coverage.test.ts`:

```
× names nothing that is already paired or no longer served
  +   "TaskCountsView is paired now — remove it from UNPAIRED",
× reports how much of the surface is actually guarded
  AssertionError: expected 80 to be 79
```

Both are the one entry (the second is its double count). Removing
`['TaskCountsView', 'no client type exists']` from `UNPAIRED` turns both green.
