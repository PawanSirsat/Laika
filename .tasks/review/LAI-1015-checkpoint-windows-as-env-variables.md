---
id: LAI-1015
title: "The checkpoint pending notice and checkpoint retention are deploy-time variables, as SPEC §9.1 promises"
area: core
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-560
started: 2026-10-31T17:42:36Z
status: review
finished: 2026-10-31T17:52:38Z
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

Board: LAIKA-869. Found writing `docs/AGENTS-ROLLOUT.md` § 4, which lists them as *constant*.

## Acceptance criteria

- [x] `server/src/env.ts` reads `LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS` and
      `LAIKA_CHECKPOINT_RETENTION_DAYS` with the claim timings' validation
      shape; `index.ts` passes them to `configureCheckpoints` before the
      scheduler starts.
- [x] SPEC §11.7 names both (a named crossing for CHIEF), and
      `env-contract.test.ts` is green with them.
- [x] A test boots with each set and asserts the value reaches
      `checkpointSettings()`; one with a malformed value asserts the
      `EnvError` names the variable.
- [ ] `docs/AGENTS-ROLLOUT.md` § 4 updated from *constant* (CHIEF).

## Notes

No new dependencies.

## Builder notes (CORE, LAI-1015)

- `server/src/env.ts`: `LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS` (default 600,
  whole seconds 1–86400, the claim timings' `parseSeconds`) and
  `LAIKA_CHECKPOINT_RETENTION_DAYS` (default 90, whole days 1–3650). Both raw
  values are read **before** the claim timings are judged, so the
  env-contract probe still discovers them; a mutant reading them after
  `readClaimTimings` turns `reads every variable §11.7 documents` red.
- `server/src/index.ts`: `configureCheckpoints(env.checkpoints)` before the
  scheduler, then a `checkpoints.configured` boot record read back from
  `checkpointSettings()`. `build.test.ts` boots with 900 s / 30 days and asserts
  the record; the mutant `configureCheckpoints({})` turns exactly that case red
  (600000 received).
- Defaults unchanged: `DEFAULT_CHECKPOINT_SETTINGS` is untouched and
  `env.test.ts` asserts `readEnv` defaults equal it.
- **Criterion 4 is left unticked:** `docs/AGENTS-ROLLOUT.md` exists only on
  `LAI-560-rollout-evidence-pack` (PR #173), and the criterion marks it CHIEF's.
  Its § 4 should now say both are §11.7 variables.
- For CHIEF, not done here: SPEC §9.1's timing table still shows `—` in the
  variable column for *Pending notice*, and the paragraph under it still says
  the notice *"becomes"* a §11.7 variable. The brief limited the SPEC edit to
  §11.7.
- The CLI helper accepts `0` for the pending notice (its e2e test uses it); the
  server refuses `0`, following the claim timings. The two agree for every value
  from 1 to 86400.
