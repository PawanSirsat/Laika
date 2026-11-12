---
id: LAI-1195
title: 'Refine the Dashboard, Sprints and Timeline space tabs'
area: shell
assignee: shell
priority: p2
depends-on: []
status: review
finished: 2026-11-11T07:37:58Z
started: 2026-11-11T00:00:00Z
---

## Goal

UX round on three space tabs, against the 17-state interaction contract
(`.polly/proposal/interaction-inventory.md`) and the visual audit
(`.polly/proposal/visual-audit.md` #9, #11, #12, sprint badge vs size chip).
UI only, `server/web/` only, existing public API, no new dependency, no demo
data, no `theme.css` edit. Not Calendar, Board, List, the space header or how
a task opens (#289).

## Acceptance criteria

- [x] Dashboard: every metric card links to the filtered view it summarises;
      charts keep their SVG, carry a text alternative and keyboard focus on
      segments; empty / loading / error-with-retry are honest.
- [x] Sprints: cards show dates, progress and forecast legibly; create and
      edit validate and report the result; delete is confirmed with focus
      moved into the confirm; empty state offers the next action; the sprint
      badge cannot be read as a size chip.
- [x] Timeline: readable bars and today marker; zoom and scroll controls are
      labelled and keyboard-operable; normal days are not tinted as errors;
      empty and error states.
- [x] All three: both themes; 390px stacks with nothing clipped and a visible
      horizontal-scroll cue; 1440px; reduced motion; theme tokens only.
- [x] Playwright interaction tests for metric links, sprint create/edit
      feedback, timeline keyboard zoom and error/retry; mutated once to prove
      they fail.
- [x] `pnpm lint`, `pnpm format` and the new/changed tests exit 0.

## Notes

Mutation: the keyboard-zoom handler and the done link's `status` were
broken once; exactly the two matching tests went red (9 pass, 2 fail), then
restored. `timeline-sprints.test.ts` "no tick label…" fails on base too
(date-dependent) and is not from this change. Board and Calendar sprint
badges are out of scope; `SprintKey` is available to them.
