---
id: LAI-1149
title: 'Profile redesign: record D-139 and rewrite the member profile screen spec'
area: docs
assignee: chief
priority: p2
depends-on: []
status: in-progress
started: 2026-11-06T02:04:45+05:30
---

## Goal

Record the owner's seven decisions on the profile design as D-139 and rewrite
SPEC §11.4.2.1's *Member profile* entry to the design, so every implementing
task has one reference. Sections a drift check reads against code (§4.59's
`kind` list, §6.4's routes, §3.1's rows) are **not** edited here: each lands
with the task that makes the code true (LAI-1150), so `master` never goes red.

## Acceptance criteria

- [ ] `docs/DECISIONS.md` has D-139 with the eight items as the owner settled them.
- [ ] SPEC §11.4.2.1 *Member profile* describes the design: chrome, head card
      with availability pill and Who looked, tabs on your own profile, the
      Overview rows, Day, Time report, Developer access, and what is removed.
- [ ] §11.4.2's sidebar row no longer says only owners and admins may open a profile.
- [ ] Task files LAI-1148 to LAI-1156 filed, each with its board card.

## Notes / context

Docs only (§4: green CI, no separate review round).
Design: the owner's *Laika Profile* (2026-11-06), frames A–G (pa–pt). Decisions: D-139. Screen spec: SPEC §11.4.2.1 *Member profile* (rewritten by LAI-1149). Durations are hours, never `h:mm` (LAI-1147). Phone (390px) and both themes are part of every UI criterion.
