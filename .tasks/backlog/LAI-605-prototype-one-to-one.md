---
id: LAI-605
title: Implement the prototype 1:1 — structure, scale, colours; accent stays purple
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-606]
discovered-from:
status: backlog
---

## Goal

The board screen matches `Laika Prototype.dc.html` one-to-one: structure,
layout, spacing, sizes, fonts and colours are the prototype's; only data and
behaviour are ours. One override: every accent use is purple
(`#A78BFA` dark / `#7C3AED` light) where the prototype uses blue. Column
status colours stay exactly as the prototype has them (backlog grey, to do
purple, in progress blue, review amber, done green).

**The source of truth is the design project** ("Skynet Kanban UI Enhancement",
`a931b00e-ce58-4723-9699-b7cb2f1567e9`), not `docs/design/` — the repo copy is
stale (see LAI-610). The current file is fetched and rendering at
`scratchpad/prototype-render.dc.html` (see Notes for the reconstruction
caveat).

## Acceptance criteria

- [ ] A value table extracted from the prototype's CSS covers every element in
      the owner's brief (header row, tabs, sprint strip, working-now strip,
      board/column/card anatomy, sidebar), and was posted to the owner before
      application.
- [ ] Values ported into the existing architecture: colours → `theme.css`
      blocks, type → `TYPE_ROLES` + generator, sizes/radii → shared tokens.
      Components reference tokens only; the prototype's stylesheet is not
      imported as-is.
- [ ] Scale fixed at the source: computed font-size/line-height/padding pairs
      match the prototype for card title, chip, issue key, column header, tab,
      sprint tile name; five columns fit at 1440.
- [ ] Surfaces: canvas → column (no border) → card (1px border) → pill/input,
      per the prototype's steps; search is a filled input in the header row.
- [ ] Chrome per the prototype: header row, tabs with count badge, sprint
      strip with active tile + DONE/BLK/LEFT + chevron, working-now pills with
      status dot and mono line, right-aligned mono summary; no separate
      toolbar row — anything moved or folded into the "…" menu is listed to
      the owner first.
- [ ] The owner's eight named deviations each confirmed fixed with a crop of
      the To do column header + first card beside the prototype crop
      (column border, header alignment, count badge, chip alphas, blocked
      banner rounding, title line-height, sprint chip tint, column scrollbar).
- [ ] Screenshots ours vs prototype at 1440 and 1920, dark then light, same
      scroll position, every visible difference listed.
- [ ] Purple is the only accent; no blue accent remains. Status blue is not
      the accent.
- [ ] Meta row never wraps; the issue key is never truncated.
- [ ] Colour-literal and font grep outside `theme.css` / `TYPE_ROLES` returns
      nothing; repo-root gate green.

## Notes / context

- Owner brief of 2026-09-20, delivered in-session; supersedes the prototype
  aspects of LAI-606's brief where they differ.
- The design MCP's `get_file` caps at 256 KiB and the current prototype is
  larger: the fetch truncates inside the data script (`insightRows`, the
  insights screen). The template and CSS are complete. The render copy grafts
  the missing tail from the older `docs/design/` copy (sprint/calendar data,
  `barMembers` builder) and stubs `insightRows: []`. **Everything grafted or
  stubbed is excluded from measurement**; the insights screen is out of the
  brief's scope. Measure structure/colours/type only from the remote template
  and CSS, which are intact.
- `support.js` (dc-runtime) is standalone — it loads React itself; serve the
  scratchpad and open `prototype-render.dc.html`.
- No new dependencies.
