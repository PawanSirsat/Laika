---
id: LAI-1216
title: 'Insights UI pass — Capacity, Usage & cost, Time: hierarchy, lead figures, charts, filters in the address, phone layout'
area: shell
assignee: shell
priority: p2
depends-on: []
status: in-progress
started: 2026-11-12T14:16:20Z
---

## Why

Owner request: *"http://localhost:3200/insights — improve the UI."* UI
transformation programme, built on the merge train + #341 + #342 (base
`LAI-1214-tooltips-home-org` @ d3efaf7d). UI only: existing public API, theme
tokens only (`theme.css` unchanged, chart colours derived from existing
tokens), no new dependencies (the in-house SVG charts stay), no demo data,
strict CSP.

## Acceptance criteria

- [ ] Audit first: every tab screenshotted dark/light at 1440/768/390 and a
      critique + plan written (`.polly/specs/insights-ui-critique.md`).
- [ ] One consistent tab header and filter bar per tab, with the current
      selection legible.
- [ ] Each tab opens with a lead row of the figures that matter, each linking to
      its breakdown; a comparison with the previous period wherever the API
      already returns one.
- [ ] Charts: readable axes, direct labels where possible, one colour per series
      across tabs, keyboard + hover/focus tooltip, table alternative kept.
- [ ] Capacity reads as a scannable roster (presence, load, current work) with
      sensible sorting.
- [ ] Usage: spend vs budget clear; alerts prominent but calm.
- [ ] Time: the report's period and filters live in the address and survive a
      reload (LAI-1189), defaults keep the address clean, the profile's use of
      `TimeReport` unchanged.
- [ ] Honest empty and low-data states; 390 stacked layout, no page-level
      horizontal scroll at 390/768/1440; both themes.
- [ ] Playwright coverage for the above, CSP violations 0, each key behaviour
      mutated once to prove the test fails.
- [ ] Gates: lint, format, web typecheck, web shards 1..4, server structure +
      task-file-state tests — each exit 0.

## Notes

- Design skills consulted (advice only; repo rules win): `impeccable`
  (critique), `dataviz`, `emil-design-eng`, `break-ui`.
- LAI-1215 (My day UI) runs in parallel: no My day files edited; shared
  component changes additive only.
