---
name: laika-logging
description: Use when finishing a task or ending a session in the Laika repo, to append the required entry to logs/<session>-<YYYY-MM-DD>.md. Gives the exact format and a worked example of what counts as a decision and a discovery.
---

# Laika logging

One log file per session per day: `logs/<session>-<YYYY-MM-DD>.md` — e.g.
`logs/builder-a-2026-08-24.md`. Append only. **Never open another session's log
file**, not even to read-and-copy the format; the format is right here.

Write an entry after **every** task and at the **end of every session**.

## Format

```markdown
## <ISO-8601 timestamp> — <TASK-ID or "session end">

**What changed**
- path/to/file.ts — one line on what and why
- path/to/other.ts — ...

**Decisions**
- <the choice> — <the alternative you rejected, and why>

**Discovered**
- <what surprised you> → LAI-0NN filed (discovered-from: <TASK-ID>)
- <or: nothing>

**State**
<one line: in review / blocked on X / handed back to backlog / session ending clean>
```

Every heading appears every time. `- nothing` is a valid and useful answer — an
empty **Discovered** section says "I looked", a missing one says nothing.

## Worked example

```markdown
## 2026-08-24T14:32:10Z — LAI-003

**What changed**
- server/src/db/schema.ts — all 11 tables from SPEC §4, ULID ids, unix-ms timestamps
- server/src/db/client.ts — better-sqlite3 with WAL, foreign_keys, busy_timeout=5000
- server/src/db/migrations/0000_initial.sql — generated, committed, applied on boot
- server/src/db/activity.ts — append-only helper; no update/delete path exists
- server/test/db/dependencies.test.ts — cycle rejection, self-reference rejection

**Decisions**
- Per-project task numbering allocates inside the insert transaction rather than
  `MAX(number)+1` read-then-write — the latter duplicates numbers when two agents
  create tasks at once, which is the normal case here, not the edge case.
- `activity` append-only is enforced by the helper module exposing no mutation
  path, not by a SQLite trigger — triggers would be invisible to Drizzle and to
  anyone reading the TypeScript.

**Discovered**
- SPEC §4.9 lists `heartbeats.task_id` but never says who resolves the branch
  name to a task. Server-side is the only place that can be trusted, since the
  plugin cannot know project keys. → LAI-013 filed (discovered-from: LAI-003).
- `exactOptionalPropertyTypes` from LAI-001 makes Drizzle's nullable-column
  inference noisy; worked around locally with explicit `| null`. Not worth a
  task yet — noting it in case it spreads.

**State**
Moved to .tasks/review/. Nothing blocked.
```

## What counts

**A decision** is a fork where a competent person would have chosen differently.
"Used Drizzle" is not a decision — the spec said so. "Allocated the number inside
the transaction instead of reading the max first" is, because it cost something
and the reason is not obvious from the diff.

**A discovery** is anything the next person would want to know and cannot get
from the code: a spec gap, a wrong assumption, a dead end you already walked
down, a library behaving unexpectedly. Dead ends are worth more than successes —
they stop someone repeating an hour of your work.

**What changed** is real paths. "Updated the schema" helps nobody at standup.

## Session end

Same format, `session end` in place of the task id, plus one line on where you
stopped and what the next session should pick up. If nothing happened, say so —
a log that skips quiet days looks identical to a log nobody wrote.
