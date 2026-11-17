---
id: LAI-1201
title: 'Refine Insights: Capacity, Usage and Time — URL-persisted filters and period, figure links, chart keyboard/SR, 390/768/1440'
area: shell
assignee: shell
priority: p2
depends-on: []
status: review
started: 2026-11-11T10:00:00+05:30
finished: 2026-11-11T12:30:00+05:30
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

- [x] Usage's period (`?range=7|30|90`) lives in the address and survives a reload; the space stays `?project=`.
- [x] Capacity's search, space, sort and filter chip live in the address and survive a reload.
- [x] Every Usage headline figure links to the breakdown that explains it.
- [x] Charts keep a text alternative and are reachable by keyboard.
- [x] Wide tables scroll inside their card with a visible cue at 390px; no page-level horizontal scroll at 390/768/1440.
- [x] Theme tokens only; `theme.css` unchanged; reduced motion respected.
- [x] Playwright coverage for the above, mutated once to prove it fails.
- [x] Gates: lint, format, web typecheck, web test script (4 shards) exit 0.

## Notes for review

- Time report filters are not in the URL: filed as LAI-1189 (shared `TimeReport`).
- Overlaps left alone: Capacity error/Retry and polling (PR #280), BreakdownCard tabs (PR #318). CapacityScreen.tsx and UsageScreen.tsx edits are small and away from those lines, but will need a merge with #280.
