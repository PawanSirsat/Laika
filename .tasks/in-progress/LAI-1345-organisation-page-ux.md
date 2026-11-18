---
id: LAI-1318
title: 'Organisation page: a modern layout, grids on every tab, folded sections for Organisation roles, Model prices and the integrations'
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-11-18T07:58:30Z
---

## Goal

The Organisation page's seven flat tabs, with settings scattered across them,
become a settings hub (the owner's choice, 2026-11-18): a side navigation
grouped by job, a bento Overview, and one focused page per section.

## Acceptance criteria

- [ ] Side navigation: Overview · Workspace (General, Time & breaks, Spaces) ·
      People & access (Members, Roles & permissions, Tokens & sign-in) ·
      Connections (All connections, GitHub, HR, Email, Teams, Outlook, AI &
      model prices) · Records (Work, Activity). The old `?tab=` ids land.
- [ ] Overview is a bento dashboard of reads the page already makes.
- [ ] Connections: an index of tiles with each state, then a page each.
- [ ] Organisation roles, Space roles, Who can do what and Model prices fold
      with a summary line.
- [ ] Security: one row per person that opens their tokens in place.
- [ ] The glass look, an accent per section, both themes; one set of hover,
      focus-visible, pressed and disabled states; reduced motion honoured.
- [ ] Nothing scrolls sideways at 390px.
- [ ] Browser tests follow sections that moved; repo-root `pnpm test`,
      `pnpm lint` and `pnpm format` exit 0.

## Notes

Web only: `server/web/src/routes/screens/organisation/` and its browser tests.
No new dependency, no design-token change. A fold's open state is remembered per
viewer in `localStorage` (`laika.org.section.<name>`), never sent anywhere.
Branched from `laika`, where KSage 2.0's work merges; an earlier attempt from
`main` (stale, and under an id already used: LAI-2005) is abandoned.

## Renumbered

Filed first as LAI-1318 on 2026-11-18 from a sweep of the git refs alone. That id is already taken on the Laika board, by a card whose task file never reached a branch here. Renumbered before anything was pushed, so no commit carries the old id. The board card carries this id as `external_ref`.
