---
id: LAI-431
title: The in-process scheduler — retention, stale flagging, expiry, backups
area: server
assignee: core
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-09-02T00:45:00Z
finished: 2026-09-02T01:40:00Z
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

- [x] All six jobs exist and run on one scheduler, started with the process and
      **stopped by the shutdown path** — `shutdown.ts` already drains the SSE
      stream; a timer that outlives it holds the process open. LAI-142 is the
      existing evidence that shutdown is easy to get wrong here.
- [x] **Every job is idempotent, proven by running it twice** and asserting the
      second run changes nothing and writes no `activity` row. Not by inspection.
- [x] **Time is injected, not read from the clock.** A test that a heartbeat 31
      days old is deleted and one 29 days old is not cannot be written against
      `Date.now()` without either sleeping or writing rows with fabricated
      timestamps — pass a clock. This is the criterion most likely to be worked
      around with a fixture that makes the test pass without proving the rule.
- [x] Stale flagging considers **both** a heartbeat and a commit, per §11.6.
      A task with a recent heartbeat and no commit is not stale.
- [x] A job that throws does **not** stop the scheduler or the process. Each run
      is isolated and logged; the next tick still happens. Prove it with a job
      that throws.
- [x] The backup job writes a **restorable** file. Restore one in the test and
      read a row out of it — a snapshot nobody has restored is a file, not a
      backup.
- [x] Retention deleting `activity` rows is **forbidden** — the append-only
      triggers make it impossible, and a test should assert the scheduler does
      not try. §4.8 has no retention.

## Notes / context

**No new dependency.** `setInterval` and `better-sqlite3`'s backup API.

**`heartbeats` is not append-only and `activity` is.** They look similar and one
of them may be deleted from. Getting that backwards is the failure this task can
cause that nothing else can.

Concurrency: one process, one scheduler (D-002). If two jobs would overlap, they
run in sequence — there is no second worker and inventing one is out of scope.


---

## Submitted — CORE, 2026-09-02

**Server 1560/1560 green**, lint and format clean. Web is red on two assertions —
the client vocabulary mirror, filed as **LAI-151**, third occurrence of that pair.

### §4.8 owed these four verbs before I asked for them

Its own D-022 note names *"heartbeat pruning, stale-task flagging, invite and
meeting-review expiry"* as things the cron writes, and the type list had a verb
for **none** of them. So the nullability rule was justified by rows the
vocabulary made impossible to write. Four in-flight exemptions in
`schema-spec-drift`, my own file.

The snapshot and the vacuum write nothing, and that is the same note's doing: it
enumerates the cron's writers and does not include them. Said at the site so a
reader finding no `appendActivity` there does not assume it was forgotten.

### The criterion you flagged as most likely to be worked around

> *"Time is injected, not read from the clock … most likely to be worked around
> with a fixture that makes the test pass without proving the rule."*

Every job takes `now` as an **argument**. So the retention tests assert the
boundary itself — 31 days deleted, 29 kept, and one exactly *on* the cutoff
deleted while one a millisecond inside is kept — rather than asserting that a
fixture agrees with itself. Same for stale flagging at ±1ms of three days.

### The backup is restored, not inspected

The test opens the written file as a fresh `Database`, reads a row, and checks
the name. There is a second one for the reason `Database.backup()` is used rather
than a file copy: Laika runs in **WAL**, so the `.db` alone is not a consistent
snapshot and a copy taken mid-write restores as corruption nobody finds until
they need it.

### Two things that did not fail when I first wrote them

**The failing job did not fail.** I used a deeply nested backup path expecting
`mkdirSync` to reject it; with `{ recursive: true }` it creates it happily, and
the test asserted on a failure that never happened. Now the parent is a **file**,
so it is a real `ENOTDIR` through the real path.

**The "never deletes a file it did not write" test could not fail.** Its foreign
filenames — `operator-notes.txt`, `laika.sqlite` — sort *after* `laika-…`, so
removing the prefix filter deleted only real backups and the test stayed green.
Renamed to sort **first**. Same class as LAI-144's `.github.io`: the test named
the right property and was constructed so the property could not be violated.

Nine mutations, all caught **after** that fix; eight before it.

### `heartbeats` may be deleted from and `activity` may not

Asserted directly: retention runs against a 400-day-old activity row and leaves
it. §4.8 has no retention and its triggers would refuse — loudly, which is the
point, and why the test exists rather than a comment.
