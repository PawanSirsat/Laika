---
id: LAI-091
title: The API cannot answer "what does this task block?"
area: server
assignee: builder-a
priority: p1
depends-on: [LAI-011]
discovered-from:
finished: 2026-08-24T20:55:50Z
started: 2026-08-24T20:43:32Z
status: review
---

## Goal

The design's task detail lists dependencies in **both directions** —
`rel: 'BLOCKED BY'` and `rel: 'BLOCKS'`. `TaskView.dependencies` returns only
`directDependencies`, which is the blocked-by half.

**The data already supports it and the index already exists.** §4.6 stores
`(task_id, depends_on_task_id)`, and §4.13 requires
**`task_dependencies(depends_on_task_id)`** — an index whose only purpose is the
reverse lookup nothing performs.

**Why it matters beyond the design.** "What am I blocking?" is the question that
makes someone unblock other people. Today a task can be holding up three others
and its own detail screen shows nothing — the information exists, indexed, and
is never read.

## Acceptance criteria

- [x] `TaskView` exposes both directions, distinguishably. Do not merge them into
      one list: **the two mean opposite things** and a screen showing them
      together is worse than showing one.
- [x] **One query for the whole page**, both directions. A board of 50 tasks must
      not issue 100 dependency lookups — assert it, as LAI-072 asks for comments.
- [x] The reverse read uses the §4.13 index. Confirm with a query plan rather
      than assuming.
- [x] `ready` is unchanged. **Readiness depends only on what blocks you**, never
      on what you block, and a test should hold that — it is the obvious thing to
      get wrong once both directions are in the same shape.
- [ ] §4.5 and §6.4 updated (D-011).

## Notes / context

Keep `discovered_from` out of this. §4.6 already warns it is **provenance, not
blocking** — a discovered task may be worked before its parent finishes. The
design shows it in a separate section for that reason, and folding it into
dependencies would make unrelated work look blocked.


---

## Builder-A notes (2026-08-25)

### The shape

`TaskView.dependencies` is unchanged and still means **blocked by**;
`TaskView.blocks` is new and means the opposite. Two lists, never merged — a task
blocking three others and a task blocked by three others are the same shape with
opposite meanings, and one list would make them indistinguishable.

I did **not** rename `dependencies` to `blocked_by`, though it would read better
now. It is the wire contract the web client already reads, and a rename is a
breaking change that deserves its own task rather than riding along beside a new
field. Filed as **LAI-129** with §4.5 and §6.4 (AC5, `docs/` is PM's).

### `UNION ALL`, not `WHERE … OR …`

Both plan identically — SQLite reaches the same two indexes either way, confirmed
by `EXPLAIN QUERY PLAN`. The difference is at the caller: with `OR`, an edge whose
**both** endpoints are on the page comes back as one row that has to be classified
twice, and working out which side matched is re-deriving in TypeScript what SQL
already knew. `UNION ALL` emits it once per direction and labels it. There is a
test for exactly that case.

### AC2 — the page cost stopped growing with the page

`toView` used to read one task's dependencies and then their statuses, per row,
so a 50-task board issued **101 queries** to render. It is now **three**, whatever
the page size: the tasks, both dependency directions, and the statuses of
everything referenced.

Asserted two ways, because the number alone is brittle: one test pins *one*
`task_dependencies` query per page, and another measures that a 20-task page
prepares the same number of statements as a 4-task page. The second is the
property; the first is the specific regression.

### AC3 — and a hole in my own first attempt

The plan test originally EXPLAINed SQL **retyped in the test**. Breaking the
production query left it green — I found that by trying it. It now captures the
statement `dependencyEdges` actually prepares off the driver and EXPLAINs that,
counting the placeholders to bind the right arity. Re-probed: making the reverse
half unindexable now fails with `SCAN task_dependencies` in the diff.

That is the same class of mistake as LAI-048's constant-compared-to-itself, and
worth recording because it looked like a real test until it was attacked.

### AC4 — `ready` is untouched

Readiness reads only `blockedBy`, and the statuses loaded are only for that
direction. A test holds it from both sides: a task that blocks another is still
ready, and finishing a blocker makes its dependent ready. Feeding `blocks` into
readiness fails four tests.

### Verification

Nine probes; eight fail when broken. The ninth — widening the status preload to
include the `blocks` direction — has **no observable effect**: it loads statuses
nothing reads. Waste rather than wrongness, and I would rather say so than build
a contorted test to catch it. The correctness half of that mutation (actually
feeding `blocks` into readiness) is probe 8 and does fail.

873 server tests pass; lint, format and typecheck clean.
