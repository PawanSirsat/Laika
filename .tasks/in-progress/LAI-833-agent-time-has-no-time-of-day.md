---
id: LAI-833
title: 'Agent working time has no time of day: My day cannot draw its AGENTS lane'
area: server
assignee: chief
priority: p3
depends-on: []
discovered-from: LAI-831
status: in-progress
started: 2026-10-21T11:26:58Z
---

## Goal

My day's lane timeline (the owner's "Laika App v2" design, LAI-831) has an
AGENTS lane: when Claude Code worked for the person, as blocks along the
hours, grey when not tied to a card. LAI-831 left it out because nothing
serves it.

## Found (LAI-831's census)

`agent_time_days` (§4.50) holds **seconds per (person, day, session, kind)**
from Claude Code's `active_time` metric. It has no time of day, so My day can
total agent minutes per card (the right column) but cannot place them on the
day. Drawing them anywhere would be inventing a time (§5.1, D-032).

## Acceptance criteria

- [ ] The server keeps when agent time happened, at a resolution that tells
      nothing about content (for example, minutes active per 15-minute bucket
      per session), from what the OpenTelemetry receiver already receives.
- [ ] `GET /me/time` serves it for the day, the person's own, session only,
      tied to a card the way agent minutes are.
- [ ] My day draws the AGENTS lane from it, grey for time on no card.
- [ ] Tests fail on today's code; the gate exits 0.

## Notes

Agent time stays minutes beside the day, never hours in it (D-088 item 8).
