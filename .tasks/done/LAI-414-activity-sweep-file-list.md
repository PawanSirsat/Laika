---
id: LAI-414
title: The activity sweep reads six service files by name, and there are thirteen
area: server
assignee: core
priority: p1
depends-on: []
discovered-from: LAI-045
status: done
started: 2026-08-31T07:31:05Z
finished: 2026-08-31T07:45:12Z
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

- [x] `emittedActivityTypes()` **discovers** the files it scans rather than
      naming them: read the directory, or derive the set from what actually
      imports `appendActivity`. No literal list of file names survives.
- [x] **Prove it fires from a file that was not in the old six.** Add an emitter
      of an unexercised type to `services/users.ts`, confirm the sweep goes red
      naming that type, then remove it. Put the failure message in your log —
      that specific case is the whole point of this task, and it is currently
      green.
- [x] The sweep still passes on unmodified `master` with all thirteen files in
      scope. If widening it turns up an emitter the sweep never produced, that
      is a real finding: **do not add it to an ignore list.** Exercise it, or
      stop and file it.
- [x] If some file genuinely must be excluded, it is excluded **by name with a
      reason, and the exclusion self-expires** — if the reason stops holding, the
      test fails and says so. This repo has been bitten six times by a
      justification that expired silently: LAI-052, LAI-080, LAI-043, LAI-213,
      LAI-066, LAI-211.
- [x] `pnpm format`, `pnpm format:fix`, `pnpm lint`, `pnpm typecheck`,
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

---

## Accepted — CHIEF, 2026-08-31

**Accepted.** Three mutations, three reds, each naming the type it demanded.

| mutation | result |
| --- | --- |
| emitter in `services/users.ts` — **the AC2 case, green before this task** | red: *"services emit these types and this sweep never produced one: `token.created`"* |
| **single-line** `appendActivity(...)` in `services/tags.ts` | red: same message, `token.revoked` |
| `sourceFiles()` returns `[]` | red on *"does not come back empty, which would make the coverage check vacuous"* |

**AC1 is met the harder way.** The criterion allowed directory-reading *or*
import-derivation; walking all of `src/` rather than just `services/` covers an
emitter added under `http/routes/` or in the `mcp/` directory LAI-406 creates,
without the guard needing an edit for that to be true.

**"No exclusion list because nothing needs excluding" is the right answer to
AC4**, not a dodge. Widening to all of `src/` turned up no emitter the sweep was
not already producing. Nothing to exclude means no mechanism to rot — which is
strictly better than a well-written exemption, and it was checked rather than
assumed.

**The file names that remain are the inverse of the defect.**
`expect(found).toContain('services/users.ts')` fails if discovery *stops
reaching* a file, where the old list failed to *look*. Same strings, opposite
direction.

**`does not come back empty` is the test I would have asked for.** A wrong path
in `sourceFiles()` yields no files → no emitted types → nothing missed → green.
Guarding the guard against passing while checking nothing is the failure this
whole task is about, applied to itself.

### Two findings inside the fix, both better than the fix

1. **The extractor was line-anchored** — `/^\s*type:/` only matched a `type:`
   that *began* a line, so a single-line `appendActivity(...)` left the guard
   green. I reproduced it: an emitter written on one line in `services/tags.ts`
   is caught now and would not have been before. **A coverage check tied to how
   source happens to be wrapped is under-coverage with extra steps.** The stated
   cost — a payload *value* that is itself an activity type reading as an
   emission — is real but currently empty, and proven so: the sweep passes on
   `master`, which it could not if a value were being misread.

2. **A sanity assertion that would have fired on correct work.**
   `expect(emitted).not.toContain('token.created')` was true today and **LAI-402
   makes it false by doing exactly what it is supposed to do.** The next builder
   would have met a red test on correct code and, reasonably, deleted it —
   removing a real guard to unblock themselves. Replaced with a property that
   cannot expire: everything found is a member of `ACTIVITY_TYPES`.

   That second one is a **category this board did not have a name for**, and it
   is now **D-037**. We have talked about justifications that expire *silently*;
   this is the mirror image — a guard that expires *loudly, onto someone else's
   correct work*. Both are the same underlying mistake: asserting a contingent
   fact as though it were a property.

### On the error that produced this task

The measurement was real and taken in `tasks.ts`, a file *on* the list, then
generalised to `services/tokens.ts`, which was not. The conclusion drawn from it
is the better lesson and it is theirs, not mine: **where you place the probe
matters as much as that it goes red — it has to sit where the next change will
land, not where the code already is.**

**LAI-402 was released back to `.tasks/backlog/` to let this go first**, with
`assignee: unclaimed` and `started:` removed — verified from the commit. That was
the right call and it was not argued.
