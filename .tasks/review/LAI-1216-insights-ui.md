---
id: LAI-1216
title: 'Insights UI pass — Capacity, Usage & cost, Time: hierarchy, lead figures, charts, filters in the address, phone layout'
area: shell
assignee: shell
priority: p2
depends-on: []
status: review
started: 2026-11-12T14:16:20Z
finished: 2026-11-13T12:40:00Z
---

## Why

Owner request: *"http://localhost:3200/insights — improve the UI."* UI
transformation programme, built on the merge train + #341 + #342 (base
`LAI-1214-tooltips-home-org` @ d3efaf7d). UI only: existing public API, theme
tokens only (`theme.css` unchanged, chart colours derived from existing
tokens), no new dependencies (the in-house SVG charts stay), no demo data,
strict CSP.

## Acceptance criteria

- [x] Audit first: every tab screenshotted dark/light at 1440/768/390 and a
      critique + plan written (`.polly/specs/insights-ui-critique.md`).
- [x] One consistent tab header and filter bar per tab, with the current
      selection legible.
- [x] Each tab opens with a lead row of the figures that matter, each linking to
      its breakdown; a comparison with the previous period wherever the API
      already returns one.
- [x] Charts: readable axes, direct labels where possible, one colour per series
      across tabs, keyboard + hover/focus tooltip, table alternative kept.
- [x] Capacity reads as a scannable roster (presence, load, current work) with
      sensible sorting.
- [x] Usage: spend vs budget clear; alerts prominent but calm.
- [x] Time: the report's period and filters live in the address and survive a
      reload (LAI-1189), defaults keep the address clean, the profile's use of
      `TimeReport` unchanged.
- [x] Honest empty and low-data states; 390 stacked layout, no page-level
      horizontal scroll at 390/768/1440; both themes.
- [x] Playwright coverage for the above, CSP violations 0, each key behaviour
      mutated once to prove the test fails.
- [x] Gates: lint, format, web typecheck, web shards 1..4, server structure +
      task-file-state tests — each exit 0.

## Notes

- Design skills consulted (advice only; repo rules win): `impeccable`
  (critique), `dataviz`, `emil-design-eng`, `break-ui`.
- LAI-1215 (My day UI) runs in parallel: no My day files edited; shared
  component changes additive only.
- **Fixes LAI-1189** (Time report filters reset on reload) here, as the brief
  asked: `components/time-report/report-address.ts` reads and writes
  `?period=&date=&from=&to=&space=&member=&kind=&link=&drafts=`;
  `TimeReport` takes optional `address` / `onAddress` props (My day and the
  profile pass neither, so they are unchanged); `ScreenOutlet` wires them for
  Insights → Time with `replaceState`. LAI-1189's own file is left in
  `.tasks/backlog/` for CHIEF to close as done-by-LAI-1216.
- Critique and plan: `.polly/specs/insights-ui-critique.md`; screenshots
  before/after in `.polly/screenshots/insights-ui/{before,after}/`.
- What changed, by tab:
  - **Time**: period and filters in the address (LAI-1189); a space's donut
    slice and table swatch are its badge's hue.
  - **Usage & cost**: Tokens shows `▲/▼ N% vs previous 7/30 days` from a read
    of twice the range (none at 90 days: 180 > the server's 92); by-space bars
    in each space's hue, *Outside any space* grey; with nothing in range, one
    empty state plus alerts and budgets and no chart of zeros; tile captions
    wrap at phone width.
  - **Capacity**: no search, chips or legend when there is nobody at all.
  - **Availability**: checked, no change needed.
- Series colour: `spaceSeries(slug)` in `theme/avatar-color.ts` (the colour
  generator, already exempt from the one-file colour rule) — the SpaceBadge
  hue mixed 72/28 toward `--text-primary`, so it clears 3:1 on the dark card.
  `theme.css` unchanged.
- Tests: `test/browser/insights-ui.test.ts` (10 cases, fixtures in
  `insights-fixtures.ts`); unit tests in `time-report-derive.test.ts` and
  `usage-derive.test.ts`. Mutations, one per behaviour, each went red: the
  address write, the comparison, the Usage space colour, the Usage empty
  return, the Capacity toolbar guard, the phone caption wrap.
