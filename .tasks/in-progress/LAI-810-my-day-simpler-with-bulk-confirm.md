---
id: LAI-810
title: 'My day: a bounded right column with Draft my time on top, and drafted blocks you can select, page through and confirm in bulk'
area: web
assignee: owner-direct
priority: p1
depends-on: [LAI-796]
discovered-from: LAI-796
started: 2026-10-20T11:13:37Z
status: in-progress
---

## Goal

My day stays readable on a busy day. Today, with live data, it is not. The
owner, 2026-10-20, with two screenshots of production:

> *"the right side list that must be limited and scroll but dont show too
> much and also show the draft my time on top on right side, also make that
> overall My Day page simplify and improve the UI UX … lot of task but i
> need to do the one by one confirm; that must show in scroll then in
> pagination; also add the all select and multi select"*

What the screenshots show:
- **The right column is unbounded.** "Waiting on your review" has **200**
  items and draws every one, so the column runs on far past the page. Draft
  my time is at the bottom.
- **The drafted list is long, one card per block**, each with six buttons:
  Confirm, Card…, General, Minutes…, Split…, Not work. Confirming a day means
  clicking Confirm on each one in turn. Some blocks need a card first: *"No
  task — pick a card or General (LAI-758 is not a card you can see)"*.

## Acceptance criteria

- [ ] **Right column:**
  - The order is **Draft my time** first, as a compact card with the switch,
    then On your plate, then Agent minutes.
  - On a laptop the column is sticky and **scrolls on its own**, within the
    viewport height. The page never runs on because of it.
  - Each On your plate group shows **at most 5** items, then "+N more", which
    leads to the right place: Inbox → Review for waiting-on-review, the
    board or List otherwise. Each group header keeps its true count.
- [ ] **Drafted list, selecting:**
  - A **select-all** checkbox in the drafted section's header, and a
    checkbox on every row.
  - Select-all selects the current page. Once it is ticked, a link offers
    "Select all N drafted", for every page.
  - When anything is selected, a **bulk bar** shows how many and their total
    time, with **Confirm selected**, **General**, **Not work** and **Clear**.
  - Shift-click selects a range.
  - Everything works by keyboard and has labels.
- [ ] **Bulk actions:**
  - They use the endpoints that exist: `POST /me/time-drafts/:id/confirm`,
    `/dismiss`, and `POST /me/time/days/:day/confirm` when the whole day is
    meant.
  - A block that cannot be confirmed as it stands, such as one with no
    visible card, is **left out of Confirm selected and named**: "2 need a
    card or General". It is never confirmed silently onto the wrong card.
  - Show progress. A partial failure leaves the failed rows selected and
    says why. A finished batch refreshes the day once, not once per row.
  - If a real server bulk endpoint turns out to be needed, the task stops
    and says so; it does not add one here (CLAUDE.md §5.1).
- [ ] **Paging:**
  - The drafted list is **paginated**: about 10 rows per page, with "1–10 of
    37" and Prev/Next.
  - The list sits in a **bounded scroll area**, so the bulk bar and pager
    stay in view.
  - The confirmed list gets the same treatment, collapsed to a summary line
    when long.
- [ ] **Simpler rows:**
  - One compact line: time range, duration, title.
  - A smaller meta line: replies, sessions, commits.
  - Per row, only **Confirm** and a "⋯" menu holding Card…, General,
    Minutes…, Split… and Not work. The menu is keyboard-operable and closes
    on Escape.
  - LAI-788's rule stays: an entry imported from Solidtime has no Edit or
    Delete.
- [ ] **Overall:**
  - Remove visual noise: one heading per section, consistent spacing, and
    the week strip and day bar unchanged in behaviour.
  - Match `docs/design/` tokens.
  - Light and dark, laptop (1440) and phone (390). On a phone the right
    column stacks under the day and stays bounded.
- [ ] **No hardcoded data.** Every count and title comes from the API.
- [ ] **Tests that fail without the feature:**
  - select-all and range select;
  - the bulk confirm that leaves out and names a block with no card;
  - partial failure;
  - paging;
  - the 5-item cap with "+N more";
  - the right column's own scroll.
  - Prove at least two of these by mutation, confirming each mutation landed.
- [ ] **Before/after screenshots** in `/tmp/laika-myday-shots/`, with a
      **busy-day fixture**: 40+ drafted blocks and 200 waiting on review.
- [ ] **Gate:** `pnpm test`, `pnpm lint` and `pnpm format`, each with its own
      exit code.
