# load-timeouts — 2026-10-20

Owner-direct build of LAI-768 (server tests time out under load) through the
orchestrator. Temporary worktree `Laika-load/`, branch `LAI-768-load-timeouts`
from `master` 3bba76d0. Not pushed, not merged. Board card LAIKA-573 moved
Backlog → In progress at the claim.

## 2026-10-20T11:27:18Z — LAI-768

**What changed**
- server/test/tooling/build.test.ts — `startBuiltServer` is the one spawn
  site; `waitForHealth` waits 40 s of wall clock (`HEALTH_BUDGET_MS`, measured),
  stops at once when the child exits, and fails naming the port, the time
  waited, the attempts and the child's output; health, keep-alive and fallback
  share one server, and "exits 0 on SIGTERM" runs last and stops it — five
  boots become three
- server/test/db/migrate.test.ts — `copyMigrations` skips drizzle-kit's
  `_snapshot.json` files (3.3 of 3.5 MB); `UPGRADE_BUDGET_MS` on all eight
  upgrade cases (the four newest already had 60 s inline, the four oldest had
  none)
- server/test/mcp/parity.test.ts — `SIDE_BUDGET_MS` (30 s) on the nine cases
  that build a side
- server/test/tooling/environment-posture.test.ts — the two probe spawns run
  at once; the closure hook awaits the async walk
- server/test/helpers/runtime-closure.ts — `packagesBranchingOnEnvironment`
  reads in batches of 32 (`READS_IN_FLIGHT`), same answer
- .tasks/review/LAI-768-…md — measurements, reproduction, proof

**Decisions**
- Measured before changing anything (table in the task file). Boot is Node
  loading modules, not migrations (~25 ms), so making migrations cheaper would
  not have helped build.test.ts — a wall-clock budget that ends early on a dead
  child did.
- Shared one server across the three read-only cases rather than all five:
  the shutdown timing kills its server with a stream open, and the built-SPA
  case needs a different public directory at boot. A failed shared boot is
  captured as data and reported by the first case, the LAI-137 pattern
  `buildError` already uses, rather than thrown from `beforeAll`.
- Budgets are per-file named constants with their measurements, never vitest's
  global timeout; no assertion changed.
- Walk concurrency is bounded (32 in flight, one package at a time) rather than
  everything at once: 3,000+ simultaneous reads is an EMFILE waiting to happen
  on a runner with a low descriptor limit, and the bounded shape measured
  close to the unbounded one.
- LAI-801 left alone, per the brief: it is not a test-timing problem (below).

**Discovered**
- **LAI-801 is a product race, not a slow test.** In
  `cli/src/activity-sync.ts`, when the deadline fires while the board GET is
  in flight, `request()` turns the `AbortError` into `{ error }`,
  `getSharing` returns `{ ok: false }`, and `syncLocked` calls `fail()` —
  which, unlike `save()`, never checks `signal.aborted`. The abandoned run
  writes a second failure (`failures: 2`, `next_sync_at` +1200 s instead of
  +600). Reproduced deterministically, no load, by setting
  `w.board.get = 'hang'` in a throwaway copy of the test (removed). The test
  is right; the fix is a guard in `cli/src`, which this brief did not allow.
  LAI-801's criteria ask the test to stop depending on timing — they should
  instead ask for the guard. Not refiled; LAI-801 is the record.
- `runtime-closure.ts` says the closure is 28 packages; it is 115 today. The
  posture test's comment now says so; the helper's header still says 28.
- The machine's own background — Defender and Spotlight at ~250% each,
  reacting to test file churn, swap 3.5 of 4 GB — puts "normal" load at 13–20
  and drove loaded runs to 50–77, more than one `yes` per core alone.
- An orphaned `node test/browser/timeline-sprints.test.ts` (ppid 1, 0% CPU)
  from `Laika-nav/server/web` has been alive since ~14:40. Not touched.

**State**
In review on `LAI-768-load-timeouts` (not pushed, not merged). Each named file
passed five times in a row under one `yes` per core after reproducing on
3bba76d0; one root gate at normal load: TEST 0, LINT 0, FMT 0. LAI-801 untouched
— it needs a guard in `cli/src`, not a test change.
