---
id: LAI-834
title: 'A drafted block''s signals are counts with no time: My day cannot draw its SIGNALS lane'
area: server
assignee: chief
priority: p3
depends-on: []
discovered-from: LAI-831
status: in-progress
started: 2026-10-21T10:39:06Z
---

## Goal

The owner's My day design (LAI-831) has a SIGNALS lane: prompts as dots and
commits as ticks, where they happened. LAI-831 left it out and shows each
block's counts as a badge instead (CHIEF's addition G: no invented,
evenly-spaced dots).

## Found (LAI-831's census)

A collector block carries `signals: { prompts, replies, sessions, commits,
marks }` — **counts for the whole block** (`PUT /me/time-drafts`,
`time_drafts.signals`). Nothing says when inside the block they happened.

## Acceptance criteria

- [ ] The collector sends, per block, when its prompts and commits happened
      at a coarse resolution (for example, counts per 5-minute bucket) — never
      what was typed, a file name, a branch or a commit message. The closed
      schema keeps refusing anything that could hold text.
- [ ] `GET /me/time` serves it to the person alone, on a web session.
- [ ] My day draws the SIGNALS lane only where those marks exist, and keeps
      the count badge for a block without them.
- [ ] Tests fail on today's code; the gate exits 0.

## Notes

Touches the collector (`cli/` or `plugin/`, SHELL) and the server (CORE).
