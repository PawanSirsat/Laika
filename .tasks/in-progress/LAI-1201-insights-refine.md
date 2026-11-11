---
id: LAI-1201
title: 'Refine Insights: Capacity, Usage and Time — URL-persisted filters and period, figure links, chart keyboard/SR, 390/768/1440'
area: shell
assignee: shell
priority: p2
depends-on: []
status: in-progress
started: 2026-11-11T10:00:00+05:30
---

## Why

UI-transformation programme, Insights screen (`/insights`). Phase 1 audit
(`.polly/phase1-ux-audit.md`) found filters not in the URL; the interaction
inventory's 17-state contract asks for clear hierarchy, loading skeletons,
keyboard and screen-reader access, both themes and 390/768/1440 layouts.
UI only, existing public API, no new dependencies, no demo data.

## Overlaps

- PR #280 owns Capacity's error/Retry and the shared `usePolled` hook — not
  re-implemented here; error states left alone.
- PR #287 changed the Insights badge link to `?tab=usage`.
- PR #318 migrates BreakdownCard to shared Tabs — no new hand-rolled tablists.

## Acceptance criteria

- [ ] Usage's period (`?range=7|30|90`) lives in the address and survives a reload; the space stays `?project=`.
- [ ] Capacity's search, space, sort and filter chip live in the address and survive a reload.
- [ ] Every Usage headline figure links to the breakdown that explains it.
- [ ] Charts keep a text alternative and are reachable by keyboard.
- [ ] Wide tables scroll inside their card with a visible cue at 390px; no page-level horizontal scroll at 390/768/1440.
- [ ] Theme tokens only; `theme.css` unchanged; reduced motion respected.
- [ ] Playwright coverage for the above, mutated once to prove it fails.
- [ ] Gates: lint, format, web typecheck, web test script (4 shards) exit 0.
