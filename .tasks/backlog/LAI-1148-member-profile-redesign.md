---
id: LAI-1148
title: 'Member profile redesign (owner''s design, 2026-11-06)'
area: docs
assignee: unclaimed
priority: p2
depends-on: []
status: backlog
---

## Goal

Parent task for the owner's design *Laika Profile* (2026-11-06): one member
profile for two cases — an owner or admin looking at someone else, and anyone
looking at their own — with four tabs in both and an Overview of rows that
share a height. Each subtask is one PR, reviewed by a separate session and
merged only on a green gate.

Subtasks, in order:
1. LAI-1149 decisions and screen spec (docs)
2. LAI-1150 profile API · LAI-1151 own developer access reads (server)
3. LAI-1152 profile shell · LAI-1153 Overview rows · LAI-1154 Activity ·
   LAI-1155 Day tab · LAI-1156 Time report and Developer access on your own (web)

## Acceptance criteria

- [ ] Every subtask is merged and live.
- [ ] Frames A–G of the design are implemented in dark, light and at 390px,
      with D-139's departures (two numbers on an empty track, no "3 to fix" on
      someone else's head, hours not `h:mm`, 400 days).
- [ ] A plain member can open their own profile with all four tabs.

## Notes / context

Design: the owner's *Laika Profile* (2026-11-06), frames A–G (pa–pt). Decisions: D-139. Screen spec: SPEC §11.4.2.1 *Member profile* (rewritten by LAI-1149). Durations are hours, never `h:mm` (LAI-1147). Phone (390px) and both themes are part of every UI criterion.
