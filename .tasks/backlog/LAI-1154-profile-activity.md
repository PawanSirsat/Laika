---
id: LAI-1154
title: 'Profile Activity: Stacked as one combined grid, days before joining marked'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-1150, LAI-1152]
status: backlog
---

## Goal

The Activity card as the design draws it (frames A and B).

## Acceptance criteria

- [ ] *Stacked* is one grid of GitHub and Local together (not three grids);
      *Split* stays the diagonal design; the Board source leaves the card.
- [ ] Days before the person joined are drawn apart, titled *· before joining*,
      with a legend chip and *· joined <date>* in the caption.
- [ ] Opens on 12 weeks on a phone or for a member of under 12 weeks, else 1 year.
- [ ] Stat tiles' subs: *of N since joining*, the longest streak's dates, *no
      single day yet*; legends with the per-source totals.
- [ ] Your own profile reads `/me/activity` (LAI-1150); someone else's the
      existing logged read.
- [ ] Browser tests for both views, both ranges and the before-joining marks.

## Notes / context

Design: the owner's *Laika Profile* (2026-11-06), frames A–G (pa–pt). Decisions: D-139. Screen spec: SPEC §11.4.2.1 *Member profile* (rewritten by LAI-1149). Durations are hours, never `h:mm` (LAI-1147). Phone (390px) and both themes are part of every UI criterion. SHELL's area (`server/web/`).
