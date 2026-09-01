---
id: LAI-119
title: Route files retype the closed vocabularies instead of reaching for them
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-071
status: done
started: 2026-09-01T15:55:00Z
finished: 2026-09-01T16:30:00Z
---

## Goal

`db/enums.ts` exists so a closed vocabulary is declared **once**: its comment says
"Declaring them once is what stops the three from drifting apart" — the TypeScript
union, the SQL `CHECK`, and the runtime list.

Two route files quietly make a fourth copy:

- `src/http/routes/tasks.ts:27-28` — `STATUSES` and `PRIORITIES` retyped by hand;
- `src/http/routes/sprints.ts` — `STATUSES` again;
- `src/http/routes/tasks.ts:37` — `created_via` inline, a fifth.

They do it for a good reason: CONVENTIONS §2 forbids `http/routes/` importing
`db/`, and the tuples are values, so `allowTypeImports` does not help.

**Nothing checks the copies against the source.** Add a status to `db/enums.ts`
and `tasks.ts` will 422 a value the database happily stores; delete one and the
route accepts a value the `CHECK` constraint refuses at write time, turning a
clean 422 into a 500. Neither drift direction has a test.

LAI-071 hit the same wall and took the other route: `services/invites.ts`
re-exports `ORG_ROLES` and `PROJECT_ROLES`, so `routes/invites.ts` reaches them
through the service layer it is already allowed to import. One declaration, no
new lint exception, no ban on barrels tripped (the file is full of real code).

That leaves the codebase with two idioms for one problem, which is worth closing
in whichever direction is judged right.

## Acceptance criteria

- [x] One idiom for every route that needs a vocabulary. If the re-export is the
      chosen one, `tasks.ts` and `sprints.ts` adopt it; if the hand-typed tuple is,
      `invites.ts` gives up its re-export and this task says why the drift risk is
      acceptable.
- [x] `created_via` in `tasks.ts:37` is included — an inline literal is the same
      duplication with less to grep for.
- [x] A test that fails when a route's accepted set and `db/enums.ts` disagree,
      **in both directions**. Without it this converges once and drifts again; the
      re-export only removes the risk for the files that use it.
- [x] Proved by breaking it: add a member to a vocabulary in `db/enums.ts` alone
      and confirm the test goes red.

## Notes / context

No behaviour changes. Every current copy happens to match its source — this is
about the guarantee, not a live bug.

Worth checking whether the same test can cover the **MCP** layer when it lands
(§7): `mcp/` may not import `db/` either, so it will meet this exact wall, and
deciding once is cheaper than a third idiom.

## Outcome

**The re-export won, by weight of practice rather than by my choosing it.** When
I opened the files, `routes/tokens.ts`, `routes/invites.ts`, `routes/users.ts`,
`routes/unlisted.ts` and `mcp/write-tools.ts` all already reached their
vocabulary through a service, and `services/tasks.ts` already carried the
re-export **with a comment naming this task**. Three files were the holdouts.

`routes/tasks.ts`, `routes/sprints.ts` and `routes/projects.ts` now reach for
them, `created_via` included.

### A fourth file the task did not list

**`routes/projects.ts` retyped `PROJECT_ROLES` and `PROJECT_VISIBILITIES`, twice
each.** LAI-119 names `tasks.ts` and `sprints.ts`; this one was found by the
structural check on its first run, not by reading the task. `services/projects.ts`
gains the re-export and the four literals are gone.

### The gap, measured before it was closed

The task says neither drift direction has a test. Half of that has since become
untrue and half was worse than described:

- **`db/enums.ts` → SQL `CHECK` is already covered.** AC4's mutation — add a
  member to a vocabulary alone — turns `schema-migration-drift.test.ts`'s
  *"matches every named CHECK"* red. That check did not exist when LAI-119 was
  filed. **AC4 is satisfied by a test I did not write**, and saying so is more
  useful than claiming credit for it.
- **The route's own accepted set was covered by nothing.** Re-typing
  `CreateBody`'s status list with `cancelled` quietly dropped left **all 1730
  tests passing**. That is the hole this task actually closes.

### The check asks the route rather than reading its imports

A test importing the same constant the route imports passes by construction. So
each case sends a deliberately invalid value and **reads the accepted set out of
the refusal** — the one place a route states what it will take:

```
POST bad status: 422 …expected one of "backlog"|"todo"|"in_progress"|"review"|"done"|"cancelled"
GET  bad status: 400 …status must be one of backlog, todo, in_progress, review, done, cancelled
```

Both entry points are asked, because they validate separately — Zod on the body,
`parseEnum` on the query — and a copy could drift in one and not the other. Both
extractors throw rather than returning `[]` if the message shape changes, or every
assertion would compare `[]` to `[]`.

Plus the behavioural half: every member is actually accepted, not merely listed.
A schema whose message and behaviour disagree fails one or the other.

And a **structural** check: no file under `http/routes/` or `mcp/` spells out two
or more members of a vocabulary as string literals. That catches the copy before
it drifts, which is cheaper than catching the drift.

### Verification

Eleven tests. Mutations, each confirmed to have landed:

| mutation | result |
| --- | --- |
| `cancelled` dropped from `CreateBody` — the drift that passed 1730 tests | red — 3 tests |
| an extra `p4` the vocabulary does not have | red — 2 tests |
| add a member to `db/enums.ts` alone (AC4) | red — `matches every named CHECK`, pre-existing |

**One mutation printed `ANCHOR FAILED` twice before it ran.** `priority: z.enum(TASK_PRIORITIES).optional(),` appears in both `CreateBody` and `UpdateBody`, so a unique-match guard refused it — twice, because my second attempt widened the anchor with a neighbouring line that is *also* duplicated between the two schemas. It landed on the third try, anchored by line number. The `EXIT=0` under each failed attempt would have read as *"the test does not catch this"* had the guard not printed.

### Notes' question about MCP

The task asks whether the same test can cover the MCP layer. **It does**:
`mcp/` is scanned by the structural check alongside `http/routes/`, and
`mcp/write-tools.ts` already imports `TASK_STATUSES` and `TASK_PRIORITIES` from
`services/tasks.ts`. The third idiom the Notes worried about never appeared.

### Gate

`@laika/server` **1740/1740**, `cli` 19/19, `pnpm lint` EXIT=0, `pnpm format`
EXIT=0. `server/web` red on LAI-208's declared assertion only.

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** Root gate `EXIT 0` — 1740 server.

**Mutation-verified in the direction that was actually uncovered:** re-typing
`StatusBody`'s enum as a literal list without `cancelled` goes red with
*"src/http/routes/tasks.ts spells out backlog, todo, in_progress, review, done —
reach for `TASK_STATUSES`"*. **The message names the file and the constant**,
which is the difference between a guard and an alarm.

### Half the premise had expired, and you said so instead of claiming it

> *"AC4's mutation — add a member to `db/enums.ts` alone — **already** turns
> `schema-migration-drift`'s 'matches every named CHECK' red. **That check did
> not exist when LAI-119 was filed**, so AC4 is satisfied by a test I did not
> write."*

**Reporting a criterion as already-met by somebody else's work** is the opposite
of the easy direction, and it is the second time this week a task's premise has
expired between filing and claiming (D-049 was the first). **A task file is a
claim by someone who was also guessing** — including about what the repo will
still be missing by the time anyone reads it.

### The direction that was uncovered is worse than the task described

> *"Re-typing `CreateBody`'s status list with `cancelled` quietly dropped left
> **all 1730 tests passing.**"*

**Measured before building**, which is what makes the rest of the task worth
doing rather than tidy.

**And the check asks the route rather than reading its imports** — *a test
importing the same constant passes by construction* — sending an invalid value
and reading the accepted set out of the refusal, at **both** entry points,
because Zod on the body and `parseEnum` on the query validate separately.
**Extractors that throw rather than returning `[]` if the message shape changes**
is the part that stops it decaying into a vacuous pass.

### A fourth file the task did not list

`routes/projects.ts` retyping `PROJECT_ROLES` and `PROJECT_VISIBILITIES`, twice
each — found by the structural check on its first run. **The check earning its
keep before it was finished** is the strongest argument for building the check
rather than fixing the three known files.

### The anchor that failed twice

`priority: z.enum(TASK_PRIORITIES).optional(),` appears in **both** `CreateBody`
and `UpdateBody`, and the widened anchor used a neighbouring line **also**
duplicated between them.

> *"Each failed attempt printed `EXIT=0` beneath it. Unguarded that reads as 'the
> test does not catch this' — **the flattering direction is available in both**."*

**That is the sharpest statement of it today**: a mutation that fails to land and
a mutation that is caught both look like a green suite, and one of them tells you
your guard works. Anchoring by line number on the third try is the right escape.
