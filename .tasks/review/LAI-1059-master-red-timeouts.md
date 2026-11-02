---
id: LAI-1059
title: 'master CI red: the device-pairing bucket test times out, and a switched model is lost before it reaches the board'
area: core
assignee: polly
priority: p1
depends-on: []
discovered-from: LAI-1050
status: review
started: 2026-11-02T00:08:34Z
finished: 2026-11-02T00:35:34Z
---

## Why

`master` CI is red, so nothing deploys (production is on `63f2dbd6`).

1. Run 41364206004 (`db8d2eb0`, the #205 merge):
   `server/test/http/routes/device-pairing.test.ts`, *every claim spends one
   bucket of 6,000 a minute, malformed ones included*, runs past vitest's 5 s
   timeout on CI. It sends 6,001 claims through the whole app.
2. Run 41363435376 (`be0ce55c`, the #209 merge):
   `cli/test/agent-session-e2e.test.ts:397`, *timed out waiting for the
   switch to reach the board* (LAI-588's model-switch test).

## Named cross-area edits (D-033)

One PR for both, by the owner's direction:

- `server/test/http/routes/device-pairing.test.ts`: the one test above.
- `cli/test/agent-session-e2e.test.ts` and, if the cause is in the code,
  `cli/src/agent-session.ts` (the self-report's read and write) and
  `cli/test/agent-session.test.ts`.

## Acceptance criteria

- [x] (1) still proves that malformed claims spend the one 6,000 bucket and
      that the claim after the last token gets `429` with `Retry-After`,
      without 6,001 full requests and without raising the timeout.
- [x] (2) the root cause is found and fixed: a real race, or a wait on the
      wrong condition. The test waits on the real condition.
- [x] Each fixed test goes red under a mutation and passes five runs in a row
      locally, one worker.
- [x] A PR into `master`, with CI green.

## What was done

1. `device-pairing.test.ts`: the test spends 5,980 of the 6,000 tokens on the
   app's own `RateLimiter`, under the key and policy `classify()` gives a
   claim, which are asserted. The clock is held. The last 21 are real
   malformed claims: twenty `422`, then `429` with `Retry-After`. It runs in
   164 ms, where it used to take more than 5 s. It goes red under four
   middleware mutations: malformed claims spend nothing, the claim goes to a
   different bucket, a claim spends twice, and no `Retry-After`.
2. **A real race, in the code** (`cli/src/agent-session.ts`). The watcher
   re-reads the state after its heartbeat answers and writes it back whole.
   A hook's `noteSelfReport` landing between that read and that write was
   lost. Measured on a failing run: `self.model` was back at
   `claude-opus-5-5` while every heartbeat was `200`. Widening the window to
   300 ms failed the e2e in 2 runs of 3. With the fix and the same widening,
   3 of 3 pass. The hooks now write `<state>.self`, which the watcher only
   reads (`selfReportOf`). The test's wait was already on the real condition
   (`reported.model`), so the e2e test is unchanged. A unit test replays the
   interleaving and goes red against the old write.
3. Five runs in a row, one worker: `device-pairing.test.ts` 22/22,
   `agent-session-e2e.test.ts` 7/7, `agent-session.test.ts` 80/80.
