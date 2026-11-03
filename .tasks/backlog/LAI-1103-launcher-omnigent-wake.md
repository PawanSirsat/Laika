---
id: LAI-1103
title: 'Launcher and Omnigent on a real device: start, stop and wake, checked live (D-117a item 10)'
area: cli
assignee: unclaimed
priority: p3
depends-on: [LAI-1039, LAI-1101]
discovered-from: LAI-1039
status: backlog
---

## Goal

D-117a item 10 and plan §8 acceptance step 5. LAI-1039 wires the launcher to
slice D's `cli/src/agent-omnigent.ts` (LAI-1101): Omnigent starts as
`omni run <laikaPollyDir> -p <prompt>` in the worktree; a run is asked to
`stop_session` before its SIGTERM; and, with `omnigent.wake_sessions`, work
the launcher does not start is posted to the agent's running local session.
All of it is unit-tested against stubs and D's fake loopback server; **none of
it has run against a real Omnigent server through the launcher**. This task is
that live check, on KvellD’s MacBook 36 GB.

(Filed first as the wake's implementation; rescoped the same day, before it
reached `master`, once slice D shipped the module and LAI-1039 wired it.)

## Acceptance criteria

- [ ] Selecting `Polly · KvellD’s MacBook 36 GB` on a trivial card starts
      `omni run … -p` in a fresh `<KEY>-auto-…` worktree; it claims and
      finishes into Review.
- [ ] `laika agent launcher stop` mid-run: the audit shows `omnigent_stop`
      `stopped` before the exit, and the Omnigent session is idle within 3 s.
- [ ] With Omnigent's start off and `wake_sessions` on, a selection posts
      `[laika] LAI-…: selected for this agent …` to the running polly session
      (audit `woken` `delivered`).
- [ ] Each recorded in the acceptance document with the audit lines.

## Notes / context

Plan: `.polly/plans/auto-pickup-capacity.md` §8 two-device acceptance, step 5.
