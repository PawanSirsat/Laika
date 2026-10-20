---
id: LAI-768
title: 'Server tests hit the 5-second vitest timeout under load (migrate, build boot, MCP parity) and turn a whole gate red (server/)'
area: server
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-765
status: review
started: 2026-10-20T10:13:48Z
finished: 2026-10-20T11:20:05Z
---

## Goal

The server suite gives the same answer on a busy machine as on an idle one,
so a local gate or a slow GitHub runner never goes red for a timeout in a test
whose code nobody touched. Filed by CHIEF (Omnigent) on the owner's direct
instruction.

## Acceptance criteria

- [x] The tests that timed out on 17 Oct under load average about 20 pass
      reliably under the same load:
      `server/test/db/migrate.test.ts` (for example "keeps the ratings and
      refuses a replace of one", "0031 adds the heatmap…"),
      `server/test/tooling/build.test.ts` ("boots, migrates, serves health",
      "built server never became healthy"),
      `server/test/mcp/parity.test.ts` ("create_task — identical activity…"),
      `server/test/tooling/environment-posture.test.ts` (60 s setup hook).
- [x] The fix makes the slow work cheaper or gives those specific tests an
      explicit, documented budget; it does not raise the global timeout and
      does not loosen any assertion.
- [ ] Proof: the root `pnpm test` exits 0 three times in a row with every CPU
      core busy (one `yes` per core, killed by PID afterwards).
      **Not run, by instruction: CHIEF replaced this proof on 2026-10-20**
      ("Raised to p1, proof narrowed" below). The replacement — each named
      file five times in a row under one `yes` per core, the failure
      reproduced first, one root gate at normal load — is met; see
      "Proof after the fix" and "The gate".

## Notes / context

Seen by the LAI-756, LAI-758, LAI-760 and LAI-765 builders: each failing test
passes when run alone. The browser-test equivalent was LAI-765.

## Raised to p1, proof narrowed (CHIEF, 2026-10-20, before any claim)

**It now reddens GitHub too.** CI / Deploy run 39405262872 on `958b0a19`
failed on `build.test.ts` "keeps an idle connection open for 65 s, and says so
(LAI-722)": *built server never became healthy on port 34931*, thrown at
`waitForHealth` (`build.test.ts:559`, 100 tries × 100 ms). In the same week,
locally, the other cases failing through that same helper were "shuts down
promptly with an SSE stream open (LAI-057)" and "serves the committed
fallback". So did migrate.test.ts's "keeps the ratings and refuses a replace
of one" (8.4 s). Three of the last 15 master runs failed this way, and a
failed run deploys nothing.

**Proof criterion, replaced.** The original asked for three full root runs
with every core pinned. This Mac has had two thermal emergencies today, so
that proof is not worth the risk to it. Instead:
- Each named file passes **five times in a row** under one `yes` per core,
  with the `yes` processes killed by PID afterwards and the kill confirmed.
- **One** root `pnpm test` exits 0 under the machine's normal load.
- The builder **first reproduces the failure** under that load on today's
  code, so the fix is shown to change the outcome.

## Built (owner-direct, 2026-10-20)

Branch `LAI-768-load-timeouts`, worktree `Laika-load/`, from `master` 3bba76d0.
Not pushed, not merged.

### Why boot is slow under load — measured first

10-core Mac (4 performance, 6 efficiency), 16 GB, with swap 3.5 of 4 GB in use
and Defender and Spotlight between them at ~400% CPU before any test ran: the
machine's *normal* load average was ~13 to 20. "Loaded" below is one `yes` per
core on top of that (load ~22 to 40, peaks to 70 with other sessions' gates).

| what | normal load | one `yes` per core |
| --- | --- | --- |
| built server, spawn → first `200` (5 boots) | 0.6 s | **7.4 – 14.8 s** (73 – 144 polls) |
| … of which migrations from nothing | ~25 ms | 121 – 235 ms |
| migrate.test upgrade case: copy the whole migrations folder | 28 – 47 ms | **1.1 – 1.6 s** |
| … the same copy without drizzle-kit's snapshots | 10 – 14 ms | 0.6 – 0.8 s |
| parity case (one or two sides) | 90 – 210 ms | 1.0 – 5.2 s |
| posture: two probe spawns, one after the other | 1.3 – 1.4 s | **17.8 – 29.8 s** |
| … the same two at once | 0.7 – 0.9 s | 11.6 – 13.9 s |
| posture: runtime-closure walk, one file at a time | 0.5 s | **30 – 47 s** (of a 60 s budget) |
| … in batches of 32 | 0.3 s | 19 – 26 s |

**The cause.** Nothing in these files is slow in itself; everything is CPU- and
file-bound, and scales 10× to 100× under contention. The built server's time
is almost all Node loading the server's modules, before `db.ready` — not the
migrations. `waitForHealth` gave it 100 tries × 100 ms (~10 s), so two of five
loaded boots missed it, as GitHub's runner did in run 39405262872. The other
files spent their time copying 3.3 MB of snapshots the migrator never reads,
doing two independent spawns one after the other, and reading 14 MB of
package source one file at a time.

### The fix — cheaper where it could be, a measured budget where it could not

- **build.test.ts.** `waitForHealth` waits **40 s of wall clock**
  (`HEALTH_BUDGET_MS`, 2.7× the slowest loaded boot measured), not 100
  attempts. It stops **at once** when the child exits — reporting the exit code
  — and a give-up names the port, the milliseconds waited, the attempts and
  everything the child printed. Health, keep-alive and fallback **share one
  server** (all `GET`s against an empty public directory); the exit-code case
  runs last and stops it. Five boots per file become three. One spawn site,
  `startBuiltServer`.
- **migrate.test.ts.** `copyMigrations` copies what the migrator reads and
  skips drizzle-kit's `_snapshot.json` files. All eight upgrade cases carry one
  named bound, `UPGRADE_BUDGET_MS` (60 s, which the four newest already had
  inline; the four oldest — LAI-493, 0029, 0030, 0031 — had none).
- **parity.test.ts.** `SIDE_BUDGET_MS` (30 s, nearly 6× the slowest loaded
  case) on the nine cases that build a side.
- **environment-posture.test.ts.** The two probe spawns run **at once**; the
  closure walk (`runtime-closure.ts`) reads in batches of 32. Both hooks keep
  their 60 s budgets.

Vitest's global timeout is untouched and no assertion changed. The failure
paths were checked by mutation, each anchor confirmed and the file restored to
its checksum: a child that dies at boot (short `LAIKA_SECRET`) was reported in
~0.7 s as *"exited with code 1 … before it ever answered health"* with the
child's own message; a 150 ms budget produced *"never became healthy on port
56142: waited 217ms over 2 attempts, against a budget of 150ms"*.

### Reproduction on today's code (3bba76d0), one `yes` per core

- `server/test/tooling/build.test.ts`: **2 failed** of 15 — "boots, migrates,
  serves health, and exits 0 on SIGTERM" and "serves the committed fallback",
  both *built server never became healthy* at ~10.3 s.
- `server/test/mcp/parity.test.ts`: **1 failed** — `set_task_sprint`, *Test
  timed out in 5000ms* (5183 ms); the others 1.0–4.2 s.
- `server/test/db/migrate.test.ts`: passed, with upgrade cases at 1.7–13.9 s
  including hooks — the 0030 case is the one that failed at 8.4 s on 17 Oct.
- `server/test/tooling/environment-posture.test.ts`: passed; its walk alone
  measured 30–47 s of the 60 s hook budget.

### Proof after the fix, each file five times in a row, one `yes` per core

Every run is `npx vitest run <file> --reporter=verbose` from `server/`, inside a
wrapper that starts `sysctl -n hw.ncpu` = 10 `yes` processes, records their
PIDs, kills exactly those PIDs, and prints `pgrep -x yes` — 0 after every
session. Load averages are what the machine showed, background included.

| file | runs | cases | each run | load (1 min) during the session |
| --- | --- | --- | --- | --- |
| `test/db/migrate.test.ts` | 5 / 5 exit 0 | 24 passed | slowest case 2.3 – 6.1 s | 31 – 43 |
| `test/mcp/parity.test.ts` | 5 / 5 exit 0 | 28 passed | slowest case 1.3 – 1.9 s | 48 – 58 |
| `test/tooling/environment-posture.test.ts` | 5 / 5 exit 0 | 13 passed | file 44.7 – 58.2 s | 67 – 77 |
| `test/tooling/build.test.ts` | 5 / 5 exit 0 | 16 passed | file 139 – 160 s; boot cases 6.7 – 14.6 s | 33 – 73 |

The case counts are test cases vitest collected, not functions: build.test.ts
has 16 (one more than before, because "boots, migrates, serves health, and
exits 0 on SIGTERM" is now "boots, migrates and serves health" and "exits 0 on
SIGTERM, after serving the cases above"), and parity.test.ts's 28 include one
generated per tool pair. In build runs 3 to 5, boot cases took 10.0 to 14.6 s —
past the ~10.3 s at which the old wait gave up.

The slowest build.test.ts case under load is not a boot: the idempotent-build
case (two `tsc` builds) took 54 to 69 s of its explicit 120 s. It never failed
and is not named here, so it is left as it is — noted for whoever sees it next.

### LAI-801, looked at and left alone

Not the same technique, and not a slow test: **a product race in
`cli/src/activity-sync.ts`.** When the deadline fires while the board GET is in
flight, `request()` turns the `AbortError` into `{ error }`, `getSharing`
returns `{ ok: false }`, and `syncLocked` calls `fail()` — which, unlike
`save()`, never checks `signal.aborted`. The abandoned run writes a second
failure: `failures: 2`, `next_sync_at` +1200 s instead of +600, exactly
LAI-788's symptom. Reproduced deterministically with no load, by setting
`w.board.get = 'hang'` in a throwaway copy of that test (deleted). The test is
right; the fix is a guard in `cli/src`, outside this task's files. LAI-801's
criteria ask for a test that does not depend on timing — they should ask for
that guard instead.
