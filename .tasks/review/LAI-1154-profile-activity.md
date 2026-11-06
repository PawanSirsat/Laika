---
id: LAI-1154
title: 'Profile Activity: Stacked as one combined grid, days before joining marked'
area: web
assignee: shell
priority: p2
depends-on: [LAI-1150, LAI-1152]
status: review
finished: 2026-11-06T11:10:04+05:30
started: 2026-11-06T10:46:16+05:30
---

## Goal

The Activity card as the design draws it (frames A and B).

## Acceptance criteria

- [x] *Stacked* is one grid of GitHub and Local together (not three grids);
      *Split* stays the diagonal design; the Board source leaves the card.
- [x] Days before the person joined are drawn apart, titled *· before joining*,
      with a legend chip and *· joined <date>* in the caption.
- [x] Opens on 12 weeks on a phone or for a member of under 12 weeks, else 1 year.
- [x] Stat tiles' subs: *of N since joining*, the longest streak's dates, *no
      single day yet*; legends with the per-source totals.
- [x] Your own profile reads `/me/activity` (LAI-1150); someone else's the
      existing logged read.
- [x] Browser tests for both views, both ranges and the before-joining marks.

## Notes / context

Design: the owner's *Laika Profile* (2026-11-06), frames A–G (pa–pt). Decisions: D-139. Screen spec: SPEC §11.4.2.1 *Member profile* (rewritten by LAI-1149). Durations are hours, never `h:mm` (LAI-1147). Phone (390px) and both themes are part of every UI criterion. SHELL's area (`server/web/`).

**Deviation (2026-11-06, belka):** claimed while LAI-1152 (profile shell,
branch `LAI-1152-profile-shell`) is not yet in `.tasks/done/` on `master`. Built in
parallel by the owner's direction; scoped to the Activity card, with
`ProfileScreen.tsx` touched only where the card is given its data source, so it
merges cleanly beside LAI-1152 and LAI-1153.

## Builder notes (2026-11-06, belka)

- **Board leaves the card entirely**, as the criterion says: no grid, legend,
  tooltip line, (i) entry or active-day count. A board action alone no longer
  makes a day active. With Developer insights off the card is the notice alone
  (no tiles, no grid) — there is nothing else left to draw.
- **Split is now the opening design** (the design and its prototype open on
  Split; was Stacked). A viewer's remembered choice still wins.
- **Range is not remembered** today, so there was nothing to keep: the opening
  range is `openingRange()` — phone or under 12 weeks a member → 12 weeks.
- **Busiest weekday follows the design's rule:** named only when one weekday is
  ahead alone on at least three of its days, else *— no single day yet* (a tie
  of two used to name both).
- `GET /me/activity` is cached for 30 s like `/people/:id/activity`
  (`api/client.ts`), and its `endpoint-coverage` exemption is removed — the
  `me/profile` line stays for LAI-1152.
- `ProfileScreen.tsx`: two props on `<ActivityCard>` (`self`, `joinedAt`).
