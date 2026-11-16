---
id: LAI-1222
title: 'UX pass on the Inbox (Review, Unlisted work) and Insights (Capacity, Usage & cost, Time) page bodies'
area: web
assignee: shell
priority: p1
depends-on: []
status: in-progress
started: 2026-11-16T16:30:00Z
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
- [ ] The summary tiles are the evidence filters: each is a toggle, only a
      meaningful one (non-zero, or the one switched on) is drawn; the
      oldest wait moves into the summary line.
- [ ] The filter bar is grouped: scope toggle | space and person dropdowns |
      clear; the evidence filters no longer repeat there.
- [ ] Age reads `12d 2h`, the exact time it entered review on its tooltip,
      and is coloured only once it is stale.
- [ ] Evidence is one quiet status Chip per row (shared Chip kit) with a
      tooltip that explains it, instead of a loud pill repeated per row.
- [ ] A decidable row has Accept / Send back quick actions on hover and
      focus, the same calls as the Review dialog; `j`/`k` move between rows,
      `a`/`s` act on the focused one, Enter opens the dialog.
- [ ] A select-all control in the bar says how many are selectable.
- [ ] Empty, loading and error states kept.

### Inbox › Unlisted work
- [ ] The same treatment: KPI-as-filter, grouped bar, quiet chips, ages.

### Insights › Capacity
- [ ] The KPI tiles are the filters (the chip row goes); Overdue is
      highlighted only when above zero; links to Review and Unlisted stay.
- [ ] A card leads with person, status, one load badge, one load bar and the
      two or three numbers that matter; agents, activity and spaces sit
      behind a Details disclosure.
- [ ] Badges share one semantics (Chip): Light, Normal, Heavy, No load,
      N overdue; Away / last seen readable.
- [ ] Activity (by hand / by agents / bookkeeping) is a compact stacked bar
      with a legend; the List view carries the same badges.

### Insights › Usage & cost, Time
- [ ] The same KPI row and filter-bar layout; charts stay the in-house ones.

### Both
- [ ] Phones (390): KPIs scroll sideways, filters fold into a Filters
      disclosure, cards single column.
- [ ] Browser tests for KPI-as-filter, filter grouping, row actions and keys,
      the evidence chip's tooltip, the Capacity card's disclosure, the phone
      layout; existing tests re-aimed honestly; each key behaviour broken
      once and seen red.
- [ ] Screenshots before/after, dark + light, 1440 + 390, in
      `.polly/screenshots/inbox-insights/`.
- [ ] Gates: lint, format, web typecheck, web build, web unit tests, browser
      tests in 8 shards.
