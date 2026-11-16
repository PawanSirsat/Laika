---
id: LAI-1222
title: 'UX pass on the Inbox (Review, Unlisted work) and Insights (Capacity, Usage & cost, Time) page bodies'
area: web
assignee: shell
priority: p1
depends-on: []
status: review
started: 2026-11-16T16:30:00Z
finished: 2026-11-16T13:15:00Z
---

## Goal

The owner's screenshots of Inbox › Review and Insights › Capacity show the
same three faults: summary tiles that repeat the filter chips beside them
(zero tiles included), a flat row of equally weighted filters, and dense rows
or cards with no hierarchy. Make the page bodies read as one structure —
tabs, one-line summary, KPI/filter row, content — using the kit and tokens.

Base: local `LAI-1188` @ b9b2e8ab. Web only (`server/web/`), existing APIs,
no new dependencies. The app shell (header, sidebar, palette, page title)
belongs to LAI-1221; My day to LAI-1223 — neither is touched here.

## Acceptance criteria

### Inbox › Review
- [x] The summary tiles are the evidence filters: each is a toggle, only a
      meaningful one (non-zero, or the one switched on) is drawn; the
      oldest wait moves into the summary line.
- [x] The filter bar is grouped: scope toggle | space and person dropdowns |
      clear; the evidence filters no longer repeat there.
- [x] Age reads `12d 2h`, the exact time it entered review on its tooltip,
      and is coloured only once it is stale.
- [x] Evidence is one quiet status Chip per row (shared Chip kit) with a
      tooltip that explains it, instead of a loud pill repeated per row.
- [x] A decidable row has Accept / Send back quick actions on hover and
      focus, the same calls as the Review dialog; `j`/`k` move between rows,
      `a`/`s` act on the focused one, Enter opens the dialog.
- [x] A select-all control in the bar says how many are selectable.
- [x] Empty, loading and error states kept.

### Inbox › Unlisted work
- [x] The same treatment: KPI-as-filter, grouped bar, quiet chips, ages.

### Insights › Capacity
- [x] The KPI tiles are the filters (the chip row goes); Overdue is
      highlighted only when above zero; links to Review and Unlisted stay.
- [x] A card leads with person, status, one load badge, one load bar and the
      two or three numbers that matter; agents, activity and spaces sit
      behind a Details disclosure.
- [x] Badges share one semantics (Chip): Light, Normal, Heavy, No load,
      N overdue; Away / last seen readable.
- [x] Activity (by hand / by agents / bookkeeping) is a compact stacked bar
      with a legend; the List view carries the same badges.

### Insights › Usage & cost, Time
- [x] The same KPI row and filter-bar layout; charts stay the in-house ones.

### Both
- [x] Phones (390): KPIs scroll sideways, filters fold into a Filters
      disclosure, cards single column.
- [x] Browser tests for KPI-as-filter, filter grouping, row actions and keys,
      the evidence chip's tooltip, the Capacity card's disclosure, the phone
      layout; existing tests re-aimed honestly; each key behaviour broken
      once and seen red.
- [x] Screenshots before/after, dark + light, 1440 + 390, in
      `.polly/screenshots/inbox-insights/`.
- [x] Gates: lint, format, web typecheck, web build, web unit tests, browser
      tests in 8 shards.

## Notes for review

- Capacity's Review and Unlisted figures are links in the summary line, not
  tiles: they are not filters, and nine tiles wrapped to two rows at 1280.
- Usage & cost and Time got the tile steps and the phone strip only; Usage's
  range and space controls stay in the page header (LAI-1221's area).
- One edit in `components/shell/`: kpi.css added to `screen-styles.ts`.
- Shard 4 is red only on the known Monday `my-day-span` flake; see the log.
- `server/test/tooling/structure.test.ts` is red on the base (HeaderSlot,
  use-org-people) — not from this branch; see the log.
