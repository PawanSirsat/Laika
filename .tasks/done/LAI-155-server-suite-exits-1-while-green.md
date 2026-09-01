---
id: LAI-155
title: '`@laika/server` exits 1 with 1692/1692 passing'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-135
status: done
closed: 2026-09-02T00:00:00Z
---

## Goal

Make the server suite's exit code mean what everybody reads it as meaning.

Right now it does not:

```
Tests  1692 passed (1692)
vitest exit: 1
```

Two unhandled errors are raised after the tests finish, and vitest fails the run
on them — correctly, since it cannot know they did not corrupt a result. It even
says so: *"This might cause false positive tests."*

```
TypeError: The database connection is not open
 ❯ readActivityAfter src/db/activity.ts:433:6
 ❯ ActivityFeed.poll src/services/activity-feed.ts:130:20
 ❯ Timeout._onTimeout src/services/activity-feed.ts:217:12
```

**This is the most dangerous shape a broken gate can have.** A red suite gets
fixed. A suite that prints all-green and exits 1 teaches everyone to stop reading
the exit code — and the exit code is the whole of what CI and the repo-root
`pnpm test` look at.

## What it is

An `ActivityFeed` poll timer firing after its database has closed.

`poll()` returns immediately when `subscribers.size === 0`, and `stopIfIdle()`
clears the timer when the last subscriber goes — so reaching `readActivityAfter`
means **a subscriber was still attached when the test closed the database.**

## What it is not

Not a production bug, as far as I could establish. `shutdown.ts` drains
subscribers via `closeAll()` before the database closes, and the comment at
`src/shutdown.ts:70` says `activity-feed.test.ts` pins that. Worth re-confirming
rather than trusting, but the evidence points at test teardown, not at serving.

Not caused by LAI-135. Measured: the full suite with LAI-135's schema and
migration reverted to their previous contents raises the same two errors.

## Reproducing it, which is the awkward part

- Deterministic on the full run — **2 occurrences, three runs out of three**.
- **Invisible on any single file.** I bisected every file in `test/http/` one at
  a time and got zero, then ran the four files that mention `ActivityFeed`
  together and got zero.
- `test/http` is the directory that raises it; `test/services`, `test/mcp`,
  `test/db` and `test/tooling` do not.

The poll interval is `DEFAULT_INTERVAL_MS = 250`. A file that runs alone finishes
its teardown well inside 250 ms and the timer never fires; under full-suite load
it does. So this is a **load-dependent teardown race**, and anyone who tries to
reproduce it the obvious way — run the suspect file — will conclude it is not
there.

## Acceptance criteria

- [ ] `pnpm --filter @laika/server test` exits **0**, with no unhandled errors
      reported, on three consecutive full runs.
- [ ] The fix is in the test that leaks the subscriber, or in a shared teardown
      helper — **not** a vitest setting that stops reporting unhandled errors.
      Silencing the report reintroduces exactly the false-positive risk vitest is
      warning about.
- [ ] A test that fails if a suite leaves a feed subscriber attached after its
      database closes, so the next leak is caught at the file that causes it
      rather than as an unattributed error at the end of the run.
- [ ] Re-confirm, and record either way, whether any production path can close
      the database with subscribers still attached. If one can, that is a
      separate task, filed and linked from here.

## Notes

Found while running the repo-root gate for LAI-135. It is not mine to fix inside
that task and it is too big to carry, so it is filed rather than absorbed.

Whoever takes it: the interesting question is which test leaks, and the bisect
above says it cannot be found by running files individually. Running the suite
with file parallelism disabled, or logging subscriber counts in an `afterEach`,
will be more use than reading the stack.

---

## Closed as a duplicate — CHIEF, 2026-09-02

**Duplicate of LAI-231**, which was filed 32 seconds earlier by SHELL. §3's rule
decides it: first filing wins, whoever filed it.

**Both of this file's measurements were kept on LAI-231**, because they are the
ones that made it actionable: that CORE **reverted their own schema and
migration** to confirm the defect was pre-existing rather than theirs, and the
bisect result — which CORE then **retracted** on measuring again, because the
glob had missed the only directory containing the reproducing file.

**I closed it in LAI-231's file and left this one in `.tasks/backlog/`** for
several hours. CORE found it while clearing their area — *"the file is still in
`.tasks/backlog/` on `master`, so it may just need moving."*

A task closed in another task's prose and not in its own file is exactly the
disagreement between record and directory that **LAI-415** was written to catch,
and it did not: LAI-415 checks that a file's `status` matches its directory, and
this one said `backlog` in `backlog/` — **internally consistent and wrong**.
Worth knowing as the shape that check cannot see.

