---
id: LAI-456
title: '`replays right up to the limit` times out under gate load — 466ms alone, 5464ms together'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-441
status: backlog
---

## Goal

`server/test/services/events.test.ts:205` — *"replays right up to the limit"* —
**failed the root gate on a 5000ms timeout**, and passes on its own:

| how it was run | duration |
| --- | --- |
| the file alone | **466ms** |
| the full root gate, server + web browser tests + cli in parallel | **5464ms** |

**An 11× slowdown, against a 5000ms default with no margin declared.** It is not
random: it is a test whose cost tracks machine contention, run on a machine that
is also driving a browser suite.

## Why p2

**This is the second flake in the root gate in one day** — LAI-452 is the other,
in `cli/`. Both were found by CHIEF running the gate rather than by the owner
running their workspace, which is the point CLAUDE.md §5 makes about *"own a
directory, gate the repo"* arriving from the other direction: **a filtered run is
where a contention flake hides**, because filtering is what removes the
contention.

**And a timeout flake is the worst-shaped one.** It reports as
`Error: Test timed out in 5000ms` — which reads as a hang in the code under test,
not as a scheduling artefact, so the first person to see it goes looking in
`events.ts`.

## Acceptance criteria

- [ ] **Find out where the 466ms goes first.** `fill(MAX_REPLAY)` is the setup;
      if the work is proportional to `MAX_REPLAY` and `MAX_REPLAY` is large, the
      fix may be that the test does not need a full buffer to prove a boundary.
      **Say what the time was actually spent on** — that determines which of the
      criteria below applies.
- [ ] **Raising the timeout is allowed only if the duration is justified.** A
      test that legitimately takes 500ms of real work under load deserves a
      declared timeout with a comment saying why. **A test that is slow because
      it builds more than it needs should get smaller instead.** Do not raise the
      number to make the red go away.
- [ ] **The neighbour is measured too.** *"refuses one past the limit"* runs
      446ms and does the same `fill`. If one has no margin, neither does the
      other, and fixing only the one that happened to fail leaves the other
      armed.
- [ ] **Prove it under contention, not alone.** Run the repo-root `pnpm test` —
      that is the only configuration where this failed — and say what the
      duration was there afterwards.
- [ ] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**CORE's own line from LAI-450 applies here**, and it is the reason this is worth
a task rather than a retry: *a timeout test that sat until vitest's five-second
limit was "passing nothing and proving nothing"*. That was a fake ignoring an
abort signal; this is a real test being starved. **Different cause, same lesson —
a duration near the timeout is information, and the suite currently throws it
away.**
