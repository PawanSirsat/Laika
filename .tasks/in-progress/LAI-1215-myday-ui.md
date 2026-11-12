---
id: LAI-1215
title: 'My day: a UI pass on the day header, timeline and summary'
area: shell
assignee: shell
priority: p2
depends-on: [LAI-1191, LAI-1214]
status: in-progress
started: 2026-11-12T20:00:00Z
---

## Goal

The owner asked: *"http://localhost:3200/my-day — improve the UI."* My day is
your day's time on a timeline: confirm, split and dismiss drafts, add entries
and breaks, the timer, the day note, settings, who has looked at your time,
keyboard shortcuts, a separate phone layout, and — with time tracking off —
your assigned and overdue work.

Audit first (screenshots dark/light at 1440/768/390, tracking on and off, and
a written critique), then a targeted pass on hierarchy: a day header whose
primary call to action is the drafts still to confirm; a timeline where a
draft, a confirmed entry, a break and agent time are told apart at a glance;
readable entry blocks; the summary panel; empty and tracking-off states that
lead somewhere.

Scope is `server/web/src/routes/screens/my-day/` and its tests only, UI only,
existing API, no new dependency, no `theme.css` change. Insights files are
LAI-1216's and are not touched; shared components change only additively.
Built on `origin/LAI-1214-tooltips-home-org` @d3efaf7d (the UI merge train +
#341 + #342); merges after #342. Dispatched by polly on
`integration-ui-transformation`.

## Acceptance criteria

- [ ] Before screenshots (pinned clock, dark/light, 1440/768/390, tracking on
      with drafts/confirmed/breaks/running timer, and tracking off) and a
      critique + plan in `.polly/specs/myday-ui-critique.md`.
- [ ] The day header leads with the drafts-to-confirm call to action when
      there are drafts, and the day total against target.
- [ ] Draft, confirmed, break and agent time are visually distinct on the
      timeline (outline vs solid vs hatched vs labelled, never counted).
- [ ] Every existing keyboard shortcut and behaviour still works; LAI-954's
      pinned-clock tests stay green.
- [ ] Tracking-off and empty states lead somewhere.
- [ ] Worst-case data (very long titles, 30 entries, overlapping drafts,
      midnight-spanning entries) does not overflow at 1440 or 390.
- [ ] Playwright (pinned clock): draft vs confirmed distinction, primary CTA,
      entry actions by keyboard, tracking-off state, 390 layout, worst-case
      data, CSP violations 0; each key behaviour mutated once and seen red.
- [ ] Gate: `pnpm lint`, `pnpm format`, web typecheck, web tests (4 shards),
      server structure + task-file-state tests each exit 0; PR into
      `integration-ui-transformation` with CI green; after screenshots in
      `.polly/screenshots/myday-ui/after/`.

## Notes

Design skills consulted (advice only; repo rules win — strict CSP, no remote
assets, theme tokens only, no new dependency): `impeccable` (critique),
`emil-design-eng`, `break-ui`, `animate` / `review-animations`.
