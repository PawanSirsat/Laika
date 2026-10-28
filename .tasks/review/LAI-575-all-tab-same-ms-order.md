---
id: LAI-575
title: "Task panel's All tab shows same-millisecond activity rows newest-first inside an oldest-first thread"
area: web
assignee: strelka
priority: p3
depends-on: []
discovered-from: LAI-543
status: review
started: 2026-10-28T12:16:48Z
finished: 2026-10-28T12:22:49Z
---

Filed by SHELL (Belka, dispatched by polly) from CHIEF's block, 2026-10-28,
while fixing the LAI-543 review blocker. That blocker was claim rows in one
millisecond ordered by ULID. This is the census finding outside LAI-543's
scope. Board: LAIKA-827.

## The defect

`server/web/src/routes/screens/board/TaskDetailPanel.tsx` builds the **All**
tab by merging comments and activity, oldest first:

```ts
].sort((a, b) => a.at - b.at || (a.kind === 'comment' ? -1 : 1))
```

The activity comes from the feed newest first (`created_at DESC, seq DESC`,
`server/src/db/activity.ts`), and a stable sort keeps the input order on a
tie. So two activity rows written in the same millisecond show **reversed**
in an oldest-first thread. That happens routinely: a claim's
`task.status_changed` and `task.updated`, or an expiry and a reclaim. It is
display only and nothing is derived from it. The History tab renders the feed
as it came and is not affected.

## Fix

Break an event/event tie by `seq` ascending (the server's insert-order
`rowid`), as `execution-derive.ts`'s `inWriteOrder` does after LAI-543's
review.

## Acceptance criteria

- [x] Two activity rows with one `created_at` show in `seq` order (oldest
      first) in the All tab, whatever order the feed handed them in.
- [x] A comment still sorts before an event on a tie.
- [ ] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Role / machine

SHELL. Owner area: `web`.

Claimed by Strelka (D-097) on a branch cut from `origin/LAI-542-agent-session-helper` @ `01618534`, per the [belka] hand-off on LAIKA-827. The file was copied in from `origin/LAI-543-execution-states`; that branch and `integration-agent-identities` still keep a `backlog/` copy (the two-copy shape, §2), which whoever merges deletes.

## Submission (Strelka, 2026-10-28T12:22:49Z)

- `server/web/src/routes/screens/board/thread-order.ts` — new: `ThreadItem`
  and `threadOrder`: `created_at`, then a comment before an event, then two
  events by `seq` ascending. A comment/comment tie now returns `0` (stable,
  so the thread's own oldest-first order holds) where the old one-liner
  returned `-1` either way round.
- `server/web/src/routes/screens/board/TaskDetailPanel.tsx` — the All tab's
  merge uses `.sort(threadOrder)`; the inline union type is `ThreadItem`.
- `server/web/test/routes/screens/board/thread-order.test.ts` — new, 5 tests:
  two events with one `created_at` fed seq-descending (the feed's order) and
  seq-ascending both come out ascending; `created_at` still decides first; a
  comment sorts before an event either way round, and before two tied events
  that keep `seq` order.
- Mutation: deleting the `a.event.seq - b.event.seq` line (grep confirmed 0
  `event.seq` lines left) turned 2 of the 5 red — *"the feed order (seq
  descending) comes out seq ascending"* and *"and before both of two tied
  events, which keep seq order"*. Restored; `shasum` identical before and
  after (`e937de42…`), file green again.

**Third criterion left unticked — inherited, not added.** Gate on this
branch after the last edit: `TEST 1`, `LINT 0`, `FMT 0`. The only failures
are the five `server/web` suites that already fail at base `01618534`
(missing client halves of LAI-534/535/541):

1. activity wording covers the server's vocabulary
2. every served endpoint has a caller, or a named reason
3. the stream subscribes to exactly what the server emits
4. every server field is visible to the client
5. describeProjectEvent

Totals: `server/web` # tests 3375, pass 3370, fail 5; `server` 4067 passed,
10 skipped (4077); `cli` # tests 667, pass 665, skipped 2. `pnpm -r
--no-bail`, so every workspace ran.
