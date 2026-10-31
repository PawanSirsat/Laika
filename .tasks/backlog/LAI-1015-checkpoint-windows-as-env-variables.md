---
id: LAI-1015
title: "The checkpoint pending notice and checkpoint retention are deploy-time variables, as SPEC §9.1 promises"
area: core
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-560
status: backlog
---

## Why

SPEC §9.1's timing table and D-115 item 9 call both windows configurable, and
§9.1 says they *"become §11.7 variables with the work that reads them
(LAI-545)"*. At `1fe55ff1` they are not: `DEFAULT_CHECKPOINT_SETTINGS` in
`server/src/services/checkpoints.ts` (10 min pending notice, 90 days
retention) is changed only by `configureCheckpoints`, which nothing outside
the tests calls. `server/src/index.ts` configures the claim timings from the
environment and not these. The helper already reads
`LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS`; the server does not, so the two
can disagree.

Found writing `docs/AGENTS-ROLLOUT.md` § 4, which lists them as *constant*.

## Acceptance criteria

- [ ] `server/src/env.ts` reads `LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS` and
      `LAIKA_CHECKPOINT_RETENTION_DAYS` with the claim timings' validation
      shape; `index.ts` passes them to `configureCheckpoints` before the
      scheduler starts.
- [ ] SPEC §11.7 names both (a named crossing for CHIEF), and
      `env-contract.test.ts` is green with them.
- [ ] A test boots with each set and asserts the value reaches
      `checkpointSettings()`; one with a malformed value asserts the
      `EnvError` names the variable.
- [ ] `docs/AGENTS-ROLLOUT.md` § 4 updated from *constant* (CHIEF).

## Notes

No new dependencies.
