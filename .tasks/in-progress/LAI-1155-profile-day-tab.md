---
id: LAI-1155
title: 'Profile Day tab: the compact day panel, for your own and someone else''s'
area: web
assignee: shell
priority: p2
depends-on: [LAI-1150, LAI-1152]
status: in-progress
started: 2026-11-06T11:15:45+05:30
---

## Goal

The Day tab as the design draws it (frames D and G), replacing the embedded
My day.

## Acceptance criteria

- [ ] Date stepper back from today (forward disabled on today, *Today*);
      *Edit in My day ›* on your own, *Read-only · only <first> can change their
      day* on someone else's.
- [ ] Tiles Tracked · Confirmed · Drafts · Meetings; timeline 08:00–18:00
      stretched to fit, the person's lane and an Agents lane, drafts dashed and
      hatched, now line, legend.
- [ ] The entries list — when, what (key + title), kind, duration in hours,
      *Confirmed* / *Draft* — and the *Agents · N on cards — beside …* line.
- [ ] Someone else's drafts shown read-only (D-102 rule 1); reads are
      `/me/time` for your own and `/people/:id/time?day=` for someone else.
- [ ] Empty day copy for both; phone layout (labels hidden, three-column list).
- [ ] Browser tests for self, other, drafts, empty, phone.

## Notes / context

Design: the owner's *Laika Profile* (2026-11-06), frames A–G (pa–pt). Decisions: D-139. Screen spec: SPEC §11.4.2.1 *Member profile* (rewritten by LAI-1149). Durations are hours, never `h:mm` (LAI-1147). Phone (390px) and both themes are part of every UI criterion. SHELL's area (`server/web/`).

**Deviation (§2 step 1), recorded on claim.** `depends-on` names LAI-1152,
which is PR #296 (green, under review, not yet merged). The owner directed
parallel builds, so this branch is cut from `origin/LAI-1152-profile-shell`
and will merge `origin/master` once #296 lands. The PR stacks on #296 until
then.
