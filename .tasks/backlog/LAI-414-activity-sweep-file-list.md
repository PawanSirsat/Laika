---
id: LAI-414
title: The activity sweep reads six service files by name, and there are thirteen
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-045
status: backlog
---

## Goal

LAI-045 built a sweep asserting that **no mutating path writes a Drizzle
property into an activity payload**, and — correctly — refused to trust it
without proving the sweep really exercises every emitter. That second assertion
is the good part:

```js
const missed = [...emittedActivityTypes()].filter((type) => !exercised.has(type)).sort();
expect(missed, 'services emit these types and this sweep never produced one').toEqual([]);
```

But `emittedActivityTypes()` finds those emitters by reading a **hand-written
list of file names**:

```js
const files = ['tasks.ts', 'projects.ts', 'comments.ts', 'sprints.ts', 'setup.ts', 'invites.ts'];
```

`server/src/services/` contains thirteen files. Measured during the LAI-045
review: the same probe emitter makes the sweep go **red from `tasks.ts`** and
**green from `users.ts`**. The guard reads only where it was told to look.

**Today this costs nothing** — all 22 `appendActivity` call sites are in those
six files, so the sweep is accurate as it stands. It stops being accurate the
first time a service file is added, and **LAI-402 adds `services/tokens.ts`**.

That is the same defect LAI-045 existed to fix — a sweep exercising 4 of 22
paths while asserting it covered all of them — reappearing one level up, in the
fix. A guard that quietly covers less than it claims is worse than no guard,
because it reads as proof.

## Acceptance criteria

- [ ] `emittedActivityTypes()` **discovers** the files it scans rather than
      naming them: read the directory, or derive the set from what actually
      imports `appendActivity`. No literal list of file names survives.
- [ ] **Prove it fires from a file that was not in the old six.** Add an emitter
      of an unexercised type to `services/users.ts`, confirm the sweep goes red
      naming that type, then remove it. Put the failure message in your log —
      that specific case is the whole point of this task, and it is currently
      green.
- [ ] The sweep still passes on unmodified `master` with all thirteen files in
      scope. If widening it turns up an emitter the sweep never produced, that
      is a real finding: **do not add it to an ignore list.** Exercise it, or
      stop and file it.
- [ ] If some file genuinely must be excluded, it is excluded **by name with a
      reason, and the exclusion self-expires** — if the reason stops holding, the
      test fails and says so. This repo has been bitten six times by a
      justification that expired silently: LAI-052, LAI-080, LAI-043, LAI-213,
      LAI-066, LAI-211.
- [ ] `pnpm format`, `pnpm format:fix`, `pnpm lint`, `pnpm typecheck`,
      `pnpm test` all green.

## Notes

No new dependencies.

**Sequenced ahead of LAI-402** — LAI-402 is the change that makes the gap real,
and a guard fixed after the file it was supposed to cover has landed is a guard
that was never applied to it. If you are already holding LAI-402, this is small
enough to do first; if that is wrong, say so rather than deferring it.

Filed from the LAI-045 review rather than folded into it: AC4 asked for the
*property* list to be derived and it is. The *file* list is a different thing and
no criterion named it, so LAI-045 was accepted and this is its own task
(CLAUDE.md §2 — criteria freeze at review).
