---
id: LAI-255
title: 'The board''s right rail: add task, live stream, agent sessions, stale'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-254]
discovered-from: LAI-248
status: backlog
---

## Goal

Phase B2 of the owner-approved prototype rebuild (2026-09-18). The 252px rail
beside the lanes (`docs/design/Laika Prototype.dc.html` lines 314–359): **Add
task**, **Live stream**, **Agent sessions** and **Stale · no movement**, each a
`--card` panel with the design's heading treatment.

All four are fed from `SpaceLive` (LAI-251) rather than opening their own
stream — the rail was the fourth consumer that made one shared `EventSource`
worth building.

## Acceptance criteria

- [ ] The rail is 252px, `flex: none`, scrolls independently, and is **hidden
      below 1180px** — the prototype's rule (line 35).
- [ ] Live stream renders real frames through `stream-presentation.ts`, with
      the `/events` caption and a pulsing dot while the stream is live.
- [ ] Agent sessions counts and lists real agent presence, purple-headed as the
      design has it.
- [ ] The stale panel lists real stale-flagged tasks and says what the
      threshold is.
- [ ] Both themes, widths 1440 / 1280 / 1180 / 900, page overflow `0` at each.
- [ ] Full gate — all three `EXIT 0`, repo root.

## Notes / context

Absorbed backlog ids, for CHIEF to close against this: **LAI-225** (project
events render as raw type names), **LAI-123** (activity label client mirror
drift), **LAI-416** (an org actor renders as "someone").

**The hide-below-1180 rule contradicts LAI-244**, which made the rail travel
with the lanes in a shared horizontal scroller. The owner's exact-match mandate
puts the prototype first; say so in the task file at review so CHIEF records
the supersession, and delete LAI-244's scroller rather than leaving two
behaviours fighting.
