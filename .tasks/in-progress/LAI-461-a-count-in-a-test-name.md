---
id: LAI-461
title: '`has no collision beyond the three recorded` — there are two'
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-131
status: in-progress
started: 2026-09-09T21:25:00Z
---

## Goal

`server/test/tooling/task-file-state.test.ts`:

```ts
const KNOWN_COLLISIONS = ['LAI-046', 'LAI-100'];    // two
it('has no collision beyond the three recorded', …) // three
```

**The list is right and the name is stale.** Nothing is broken — this is a
one-word fix — but it is worth doing deliberately, because of *when* it went
stale.

## Why it is interesting rather than trivial

**The companion test `still has every collision the exemption claims` is what
made the name wrong.** It goes red the moment a recorded collision is resolved
and not removed, so somebody removed a third entry and the suite went green.
**The guard did exactly its job, and the sentence describing the guard went stale
in the same commit.**

That is the third instance of one defect in a single day, in three unrelated
files:

| | said | was |
| --- | --- | --- |
| `CLAUDE.md` §2 | *"ten listed and eleven served"* | eleven and eleven, since LAI-433 |
| LAI-436's sprint fixture comment | *"now is pinned by the sprint that contains today"* | `now` was never pinned |
| **this test name** | *"the three recorded"* | two |

`CONVENTIONS.md` §4 now carries the rule: **do not put a count in a name or a
comment when the code holds the list.**

## Acceptance criteria

- [ ] The name **stops carrying a number**. *"beyond the recorded collisions"*
      says the same thing and cannot go stale. **Do not fix it by writing "two".**
- [ ] **Sweep the rest of `server/test/tooling/` for the same shape** while you
      are there — a count in a test name or a comment where a `const` array,
      `Set` or `Record` beside it is the actual source. **Report what you find,
      including "nothing else"**, so the next person does not repeat the sweep.
- [ ] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**Do not add a guard for this.** A test asserting `KNOWN_COLLISIONS.length === 2`
would be the same defect one layer down — a second copy of the number, and the
one that fails when the list legitimately changes. **The fix is to stop writing
the number, not to check it.**
