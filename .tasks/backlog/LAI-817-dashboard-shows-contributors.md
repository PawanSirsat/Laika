---
id: LAI-817
title: 'Dashboard: "Work by person" ranks open work instead of contribution, and Stale, Blocked, the donut and % done mislead'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-796
status: backlog
---

## Goal

A space's dashboard answers "who contributed in this range" honestly, and
every other figure on it says what it counts. **D-092 is the contract.**

## Found (audit-metrics-sense, 2026-10-20, reproduced from production)

- **Work by person** (`server/web/src/routes/screens/dashboard/summary-derive.ts:140-164`,
  range filter `card-filters.ts:152-188`, wired `DashboardScreen.tsx:261-270`):
  open tasks with `updated_at` in range, by **current** assignee. In OnRoute
  over 7 days: Ashutosh 24 (14 review, 8 to do, 2 in progress, 7 blocked),
  Unassigned 15, Sakshi 7, Pawan 6.
- **Who actually delivered** (moves into review or done, by actor, with an
  agent credited to its token owner): 7 days Ashutosh 23, Pawan 3; 30 days /
  all time Pawan 168, Ashutosh 86, Sakshi 16. `task.status_changed` rows
  carry `actor_id`, `actor_kind` and `from`/`to`. The dashboard already loads
  the range's activity (`use-dashboard.ts:110-113`), and OnRoute's 3,848 rows
  fit under the 5,000-row client cap (`every-page.ts:18`).
- **Donut centre "52 open tasks"**: OnRoute has 301 open.
- **Stale 266** (`summary-derive.ts:225-239`) counts any open task more than
  5 days untouched. The server's rule (`jobs.ts:277-304`, §11.6) flags **7**.
  Of the 266, 37 are in review (median wait 8 days).
- **Blocked 30** is true, but 19 are backlog waiting on backlog.
- **"N updated"** is bumped by sprint moves, reorders, branch matches and PR
  links, so it really means "touched".
- **Status overview "% done"** is of tasks touched in the range: 15% on
  7 days against 42% project-wide.
- **Due dates**: only 2 of 301 open tasks have one.

## Acceptance criteria

- [ ] **Contributors.** The card is titled "Contributors" or similar. It ranks
      people by **Delivered** in the range (D-092 item 1): an agent's move is
      credited to its token owner, and a task moved twice counts once. A
      **Reviewed** column sits beside it, and self-closes are footnoted. It is
      built web-only from the activity the screen already loads; no new
      endpoint.
- [ ] **Open work now.** A second tab, **"Open work now"**, ignores the range
      and splits **waiting for review** out of each person's open work
      (D-092 item 2). Unassigned stays.
- [ ] **Donut.** The donut centre and its label say what they count, for
      example "52 of 301 touched in 7 days", or the donut shows all open.
      Pick one and say why.
- [ ] **Needs attention.**
      - **Stale** uses `stale_flagged_at`, the server's rule. Check that the
        task payload carries it; if not, stop and report.
      - Add a **"Waiting for review > 5 days"** entry.
      - **Blocked** counts to do and in progress, with backlog chains shown
        apart.
- [ ] **Labels.** "Updated" is relabelled "touched". The status overview's
      centre shows project-wide % done, or is labelled "of tasks touched".
      The due tile says when few tasks have due dates.
- [ ] **Tests.** They fail on today's code:
      - the contributor ranking from a fixture of status changes: an agent's
        move is credited to its owner, a task moved twice counts once, and a
        review→done by someone else counts as Reviewed;
      - Open work now ignores the range;
      - stale uses `stale_flagged_at`.
      Prove two by mutation.
- [ ] **Screenshots.** Before and after, light and dark, 1440 and 390, in
      `/tmp/laika-dash-shots/`, with an OnRoute-like fixture.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.
