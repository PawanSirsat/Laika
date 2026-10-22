---
id: LAI-975
title: 'The Work page is one long list with no header, figures or pages'
area: web
assignee: shell
priority: p1
depends-on: [LAI-974, LAI-952]
discovered-from:
started: 2026-10-22T16:37:12Z
status: in-progress
---

## Goal

The owner (2026-10-22, screenshot of /work): same header as the other pages
(Inbox's), a short analytics strip on top, filters over everyone, and
pagination with counts — **good and minimal**.

## Acceptance criteria

- [ ] Header matches the shell's other page headers (Inbox / review
      screen's structure, title, sub-line and spacing) — reuse the shared
      header component, no one-off.
- [ ] A compact summary strip under the header from
      `GET /api/v1/tasks/summary` with the **current filters**: total, and
      status counts as small tiles (In progress, Review, To do, Backlog,
      Done), plus Overdue and Blocked when non-zero; clicking a tile sets the
      status filter (and clears it on second click). An owner/admin sees a
      short "by person" row (top people with counts; click filters to that
      person). Figures only from the server; no client counting.
- [ ] Pagination: page size 25 by default (25 / 50 / 100 choice remembered
      in the URL), footer *"1–25 of 142"* with previous / next (keyboard
      reachable), built on `next_cursor` with a client cursor stack for
      previous; the page resets to 1 when a filter changes; "Load more"
      removed.
- [ ] Minimal: no new colours; design tokens only; both themes; 1440 and
      390 (strip wraps, no sideways scroll); loading and empty states for the
      strip.
- [ ] Browser tests (pinned clock if dates shown): counts render from a
      fixture, tile click filters, page 2 then previous returns page 1 rows,
      count text correct at the last page, member sees no "by person" row.
- [ ] Gate exit 0 on a branch with LAI-974 merged (endpoint coverage green).
