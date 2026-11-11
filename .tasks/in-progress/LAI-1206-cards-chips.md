---
id: LAI-1206
title: 'Polished task cards, chips, avatars and status markers'
area: shell
assignee: shell
priority: p2
depends-on: []
status: in-progress
started: 2026-11-11T09:00:00Z
---

## Goal

One chip/badge family, one avatar/presence primitive, and a task card with a
clear key · title · meta hierarchy and honest agent attribution (the four-lane
model in `.polly/proposal/workroom-and-deliverables.md` §1.4: an agent is
*selected*, never *assigned*). UI only, `server/web/` only, existing data.

## Acceptance criteria

- [ ] One `Chip` primitive with semantic variants status, priority, size,
      sprint, tag and count — each told apart by shape or glyph, not colour
      alone (WCAG 1.4.1); one height, padding and type step; truncation keeps
      the full text for screen readers.
- [ ] Sprint chips can no longer be read as size chips (`S2` vs `S`).
- [ ] Task card: max two-line title, fixed meta-row order, attribution worded
      from real fields (accountable person vs requested/executing agent),
      hover/focus/selected/dragging states, overdue and blocked markers.
- [ ] `Avatar` + presence dot + `AvatarGroup` (+N overflow) primitives with
      initials and image-error fallbacks.
- [ ] Board card, list row chips, drawer header chips and sidebar badges use
      the primitives; the rest censused with follow-ups listed in the log.
- [ ] Both themes, 390/768/1440, reduced motion, keyboard and screen reader.
- [ ] Unit + browser tests (worst-case data, chips without colour,
      attribution wording, card states), each key behaviour mutated once.
- [ ] `pnpm lint`, `pnpm format`, web typecheck and the sharded web test
      script exit 0.

## Notes

Design skills applied as advice (repo rules win — strict CSP, no remote fonts,
theme tokens only, no new dependencies): `impeccable` (critique → polish),
`emil-design-eng`, `break-ui` (worst-case data). Not used: oil-ui, stageshow,
taste-skill.

Overlapping open PRs: #315 (SprintKey) and #322 (sprint pill on cards) should
adopt the `Chip` sprint variant; #289 drawer, #321 workroom lanes, #318
tooltips, #291 glass.
