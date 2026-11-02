---
id: LAI-1059
title: 'master CI red: the device-pairing bucket test times out, and a switched model is lost before it reaches the board'
area: core
assignee: polly
priority: p1
depends-on: []
discovered-from: LAI-1050
status: in-progress
started: 2026-11-02T00:08:34Z
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

- [ ] (1) still proves that malformed claims spend the one 6,000 bucket and
      that the claim after the last token gets `429` with `Retry-After`,
      without 6,001 full requests and without raising the timeout.
- [ ] (2) the root cause is found and fixed: a real race, or a wait on the
      wrong condition. The test waits on the real condition.
- [ ] Each fixed test goes red under a mutation and passes five runs in a row
      locally, one worker.
- [ ] A PR into `master`, with CI green.
