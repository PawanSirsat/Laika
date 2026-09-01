---
id: LAI-431
title: The in-process scheduler — retention, stale flagging, expiry, backups
area: server
assignee: core
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-09-02T00:45:00Z
---

## Goal

§11.6 specifies **one interval-driven scheduler in the same process**, and
nothing in `server/src/` implements it. Six jobs:

| job | rule |
| --- | --- |
| SQLite snapshot | nightly to `$DATA_DIR/backups/`, **keep 14** |
| heartbeat retention | delete older than **30 days** |
| stale-task flagging | `in_progress` with no heartbeat or commit for **3 days** sets `stale_flagged_at` |
| invite expiry | per §4.11 |
| meeting-review expiry | **7 days** |
| vacuum | weekly |

**Jobs are idempotent and write to `activity` only when they change something.**

## Acceptance criteria

- [ ] All six jobs exist and run on one scheduler, started with the process and
      **stopped by the shutdown path** — `shutdown.ts` already drains the SSE
      stream; a timer that outlives it holds the process open. LAI-142 is the
      existing evidence that shutdown is easy to get wrong here.
- [ ] **Every job is idempotent, proven by running it twice** and asserting the
      second run changes nothing and writes no `activity` row. Not by inspection.
- [ ] **Time is injected, not read from the clock.** A test that a heartbeat 31
      days old is deleted and one 29 days old is not cannot be written against
      `Date.now()` without either sleeping or writing rows with fabricated
      timestamps — pass a clock. This is the criterion most likely to be worked
      around with a fixture that makes the test pass without proving the rule.
- [ ] Stale flagging considers **both** a heartbeat and a commit, per §11.6.
      A task with a recent heartbeat and no commit is not stale.
- [ ] A job that throws does **not** stop the scheduler or the process. Each run
      is isolated and logged; the next tick still happens. Prove it with a job
      that throws.
- [ ] The backup job writes a **restorable** file. Restore one in the test and
      read a row out of it — a snapshot nobody has restored is a file, not a
      backup.
- [ ] Retention deleting `activity` rows is **forbidden** — the append-only
      triggers make it impossible, and a test should assert the scheduler does
      not try. §4.8 has no retention.

## Notes / context

**No new dependency.** `setInterval` and `better-sqlite3`'s backup API.

**`heartbeats` is not append-only and `activity` is.** They look similar and one
of them may be deleted from. Getting that backwards is the failure this task can
cause that nothing else can.

Concurrency: one process, one scheduler (D-002). If two jobs would overlap, they
run in sequence — there is no second worker and inventing one is out of scope.
