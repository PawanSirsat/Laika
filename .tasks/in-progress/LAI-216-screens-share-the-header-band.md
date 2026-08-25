---
id: LAI-216
title: Sprints, Timeline and Dashboard do not use the shared header band
area: web
assignee: builder-b
priority: p1
depends-on: []
discovered-from: LAI-070
status: in-progress
started: 2026-08-25T01:06:00Z
finished:
---

## Goal

`ScreenHeader` exists because the prototype gives every screen the identical
band: `12px 18px` on `var(--card)`, a bottom border, the title at 15px/800 and a
10px `--tx3` context line beside it, with controls pushed right.

**Three of the six in-app screens do not use it:**

| Screen | Uses `ScreenHeader` |
| --- | --- |
| Board, Projects, Members | yes |
| **Sprints, Timeline, Dashboard** | **no** |

Timeline instead renders a large page-level heading with a prose subtitle
("One bar per sprint. Tasks have no dates of their own…") sitting directly on
`var(--page)`. Beside the Board it reads as a different application.

This is the owner's current directive — bring the whole UI into line with
`docs/design/` — and it is the cheapest large win in it: the component is
already built and already correct.

## Acceptance criteria

- [ ] `SprintsScreen`, `TimelineScreen` and `DashboardScreen` render
      `ScreenHeader` and no competing page-level heading.
- [ ] Each supplies a `context` that is **true and derived**, never a fixture:
      - Timeline — the real span and sprint count, e.g. `27 Jul → 31 Aug · 4 sprints`.
      - Sprints — the project and its real sprint count.
      - Dashboard — what the numbers actually cover.
      A screen with nothing true to say omits `context` rather than inventing one.
- [ ] Nothing that is currently reachable stops being reachable: Timeline's
      explanatory sentence is real information about a real constraint (D-014,
      tasks have no dates) and must survive somewhere sensible, not be deleted
      to make the header fit.
- [ ] A guard fails if an in-app screen renders its own top-level heading
      instead of `ScreenHeader`. Pre-auth screens (Login, First boot, Invite)
      are exempt — they have no app chrome — and the exemption is listed, not
      implicit. Prove the guard can fail.
- [ ] Both themes, driven through the real theme control.

## Notes

- `ScreenHeaderProps` is `{ title, context?, children? }`; `children` are the
  right-aligned controls. The Board is the worked example.
- Check the screens' own top padding after the swap — several add page padding
  that assumed a heading above them, and the band brings its own.
