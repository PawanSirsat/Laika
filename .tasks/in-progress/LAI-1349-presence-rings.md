---
id: LAI-1349
title: "Status rings on people in the board filters and person pickers"
area: server
assignee: chief
priority: p2
depends-on: [LAI-1348]
discovered-from: LAI-1348
status: in-progress
started: 2026-11-18T20:26:41Z
---

## Goal

The owner, 2026-11-19, after LAI-1348 went live. Board card LAIKA-1144.

People online or away get the same status ring as the header's who's-here: green online, amber
away. It appears in four places:
- the board and List toolbar's member faces;
- the members popover;
- the toolbar's Assignee dropdown options;
- the space bar's members.

All of them read **one shared** `/presence/people` poll, the one the header already makes.
Nothing is read twice. With presence off there are no rings.

Scope: `server/web/` only — the shared poll (`api/`), the Avatar ring (`components/avatar/`), and
the board toolbar, members popover and space toolbar that draw it, with their tests.

## Acceptance criteria

- [ ] Online people show a green ring and away people an amber ring: in the toolbar member stack,
      the members popover, and the Assignee options.
- [ ] The header and these share a single poll.
- [ ] With presence off there are no rings.
- [ ] Existing tests stay green; CI is green on the PR.

## Notes

- The owner asked for it to be merged and released to Ksage quickly. PR into integration-ksage.
