---
id: LAI-091
title: The API cannot answer "what does this task block?"
area: server
assignee: builder-a
priority: p1
depends-on: [LAI-011]
discovered-from:
started: 2026-08-24T20:43:32Z
status: in-progress
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

- [ ] `TaskView` exposes both directions, distinguishably. Do not merge them into
      one list: **the two mean opposite things** and a screen showing them
      together is worse than showing one.
- [ ] **One query for the whole page**, both directions. A board of 50 tasks must
      not issue 100 dependency lookups — assert it, as LAI-072 asks for comments.
- [ ] The reverse read uses the §4.13 index. Confirm with a query plan rather
      than assuming.
- [ ] `ready` is unchanged. **Readiness depends only on what blocks you**, never
      on what you block, and a test should hold that — it is the obvious thing to
      get wrong once both directions are in the same shape.
- [ ] §4.5 and §6.4 updated (D-011).

## Notes / context

Keep `discovered_from` out of this. §4.6 already warns it is **provenance, not
blocking** — a discovered task may be worked before its parent finishes. The
design shows it in a separate section for that reason, and folding it into
dependencies would make unrelated work look blocked.
