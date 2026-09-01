---
id: LAI-440
title: The Board's WORKING NOW strip and the agent-sessions rail card
area: web
assignee: shell
priority: p3
depends-on: [LAI-432]
discovered-from:
started: 2026-09-01T20:40:00+05:30
status: in-progress
---

## Goal

Two surfaces on the Board that render their headings and **zero content**,
because the endpoint behind them did not exist. It does now — `GET /presence`,
LAI-432.

- **"WORKING NOW"** — the strip above the columns. Renders its heading and no
  chips.
- **The agent-sessions rail card** — same.

Both were built against demo data and have been empty in the shipped build since
`VITE_LAIKA_DEMO` was turned off (D-032).

## Acceptance criteria

- [ ] Both render from `GET /presence` and are empty **only when nobody has a
      heartbeat in the last five minutes**.
- [ ] **A heading with nothing under it is a state, and it says which** — "nobody
      is working right now" reads differently from a strip that has not loaded,
      and both read differently from `enabled: false`. Three states, three
      renderings.
- [ ] `enabled: false` **hides the strip entirely** rather than showing an empty
      one. On the Board, unlike Capacity, there is nothing to explain — an org
      with presence off should not have a permanent empty band on its main
      screen.
- [ ] An entry with **no `repo`** (LAI-438) renders as a person, not as a broken
      chip. Same case as LAI-439's, and the one to test.
- [ ] Agent sessions distinct from humans, reusing LAI-411's badge.
- [ ] **No demo module survives.** If either surface still imports from
      `src/demo/`, that import goes — and the test asserting no demo string
      reaches the bundle (D-032) must still pass.
- [ ] Both themes. Full gate green.

## Notes / context

**The WIP badges on the lanes are not this task** and have no endpoint: SPEC has
not settled per-column limits, so they stay absent rather than being derived from
something that looks close.

**Do not put a fourth presence renderer in the tree.** Whatever LAI-439 builds
for a presence entry is the component this reuses — if LAI-439 has not landed
yet, this task waits for it rather than racing it.
