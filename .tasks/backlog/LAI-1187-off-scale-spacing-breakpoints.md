---
id: LAI-1187
title: 'Off-scale spacing and breakpoints: take the LAI-1220 exemptions onto the scale, a screen at a time'
area: shell
assignee: unclaimed
priority: p3
depends-on: [LAI-1220]
discovered-from: LAI-1220
status: backlog
started: null
finished: null
---

LAI-1220 gave radius, spacing and breakpoints one scale each and a guard
that refuses a new raw literal. It moved only what a token matched
**exactly**, because it was told not to change a layout. What it left is
named in two exemption lists, and this task works them down.

## What is left

- **Spacing:** `server/web/test/spacing-exemptions.ts` — every padding,
  margin and gap declaration still carrying a raw length, file by file, and
  the reason its value is off the scale (odd pixels 3/5/7/9/11/13/15, rem
  fractions, hairlines, and widths between steps above 16px). Read the
  numbers from that file, not from here.
- **Breakpoints:** `BREAKPOINT_EXEMPT` in
  `server/web/test/breakpoint-tokens.test.ts` — the `@media` widths that
  differ from every name in `server/web/src/theme/breakpoints.ts`, with what
  reflows there and how far the nearest named width is.

## Acceptance criteria

- [ ] Each screen taken on is moved onto the scale in one pass: odd-pixel
      and fractional spacing onto the nearest step, breakpoints onto the
      nearest named width, its lines deleted from the exemption lists.
- [ ] Before/after screenshots of each screen touched at 390 and 1440 in
      both themes, compared, and any visible shift either accepted by the
      owner or reverted to an exemption with a better reason.
- [ ] Hairline (1px) offsets stay exempt unless a border change removes the
      need for them.
- [ ] `spacing-tokens.test.ts` and `breakpoint-tokens.test.ts` stay green
      and their staleness checks prove each removed line is really gone.
- [ ] Root gates `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Notes

Highest counts first is a reasonable order (my-day, task panel, board,
developer v3 design, profile). The board toolbar's and the timeline's 760px
are 8px from `tabletSm` (768): the cheapest breakpoint wins.
