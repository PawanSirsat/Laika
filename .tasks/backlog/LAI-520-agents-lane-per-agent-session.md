---
id: LAI-520
title: 'The AGENTS lane per agent session — so My day can draw the design''s Expand / Collapse and *N agents · Xh Ym*, each run named by its card'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-512
status: backlog
---

## Goal

The owner's TimelineV2 draws the AGENTS lane as runs per agent (kepler,
lyra, vega…), each on its card, with an *Expand* button and *5 agents ·
7h 50m* in the lane column. `agent.lane` is one merged series of
`[bucket, seconds, seconds on a card]`, so LAI-512 draws *Agent · 60 min*
and no count. This task gives the day view what it needs; the web half is a
second task CHIEF files when this lands.

## Acceptance criteria

- [ ] `GET /me/time` answers, beside `agent.lane`, the day's runs by one-way
      session key: start, end, seconds and the card each was tied to — never a
      session id, a prompt, or anything typed.
- [ ] A count of the day's distinct sessions, so the lane column can say
      *N agents*.
- [ ] D-088 item 8 stands: agent time is minutes beside the day, never added
      to it. SPEC §4.50–§4.51 updated; tests.

## Notes / context

What an agent is called (kepler, lyra) is not something the board knows
today; a run may be named by its card until it does. D-112.
