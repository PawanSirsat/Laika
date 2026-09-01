---
id: LAI-228
title: The context document's size refusal never names the actual length over REST
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-412
status: review
started: 2026-09-01T16:35:00Z
finished: 2026-09-01T17:00:00Z
---

## Goal

SPEC §7.3 requires that exceeding the context document's bound is **"a `422`
naming both the limit *and the actual length*"** — because "a caller that has to
guess how much to cut will guess wrong". `updateProjectContext` raises exactly
that error, and **it is unreachable over REST**.

The route's schema (`http/routes/projects.ts`) carries
`context_md: z.string().max(CONTEXT_MD_LIMIT)`, so zod refuses first and the
service's error never runs. Measured against a running instance:

```
PATCH /api/v1/projects/laika-core/context      (100,400 characters)
422 {"error":{"code":"unprocessable","message":"Invalid request body",
     "details":{"issues":[{"path":"context_md",
       "message":"Too big: expected string to have <=100000 characters"}]}}}
```

The limit is there, in prose. **The actual length is not**, which is the half
§7.3 singles out as the one that matters.

The comment above the schema already states the intent — *"The size bound is the
service's (`CONTEXT_MD_LIMIT`), not this schema's"* — and the schema then
enforces it anyway, so the intent and the code disagree.

## Acceptance criteria

- [x] `PATCH /projects/:slug/context` over the limit returns the **service's**
      error, with `details: { limit, length }`.
- [x] MCP keeps the same error — the bound lives in the service precisely so
      both entry points agree (LAI-404), and this must not fix REST by moving
      the rule back into a route.
- [x] A test asserts `details.length` is the **actual** submitted length, not
      the limit. Asserting only the status would pass today.
- [x] Whatever guard replaces `.max` still refuses a non-string and an absent
      field — dropping the schema rule entirely must not open those.

## Notes

Found while building the context editor (LAI-412). **The client currently reads
both shapes** (`api/project-context.ts`, `readableContextError`) and supplies the
length itself, because it knows what was just typed. That workaround should be
removed when this lands — it is marked with this task id.

Worth a moment on the general pattern: a bound enforced in two layers is
enforced by whichever runs first, and the more informative one lost. The same
shape could exist wherever a zod `.max` shadows a service rule.

## Outcome

`ContextBody` is `z.string()`. The size bound is the service's, which is what the
comment above it already claimed.

**Both halves were true and the combination was not.** The comment said the
service owned the rule; the schema enforced it anyway; zod runs first, so its
refusal — naming the limit and not the length — was the only one a REST caller
could reach. MCP, which does not pass through zod, had the better message all
along.

### `z.string()` stays, and AC4 is not a formality

Dropping the line entirely would hand a **number** to `input.context_md.length`
— `undefined` — and `undefined > CONTEXT_MD_LIMIT` is `false`, so an oversize
non-string would have been **stored**. The type is the schema's job; the size is
the service's. Mutated to `z.unknown()` to confirm the new test catches it.

### The existing test passed against the bug

Worth stating plainly, because it is the more interesting half:

```js
expect(await res.text()).toMatch(/100000|100,000|100_000/);
// "Whether zod or the service refuses it, the caller must learn how much to cut"
```

It matched the **limit**, which both errors carry, and its comment explicitly
tolerated *"whether zod or the service refuses it"* — the exact difference §7.3
singles out. A test that names the right property and is built so the property
cannot be violated.

It now asserts `details` equals `{ limit, length }` with the real submitted
length, plus that `length !== limit`, so a service echoing the limit fails.

### AC2, stated precisely

**There is no MCP tool for the context document today** — nothing outside
`routes/projects.ts` calls `updateProjectContext`. So AC2 is satisfied
structurally rather than by a new assertion: the bound stayed in the service, and
`test/services/project-context.test.ts` already pins the error shape any future
tool would get. I did not fix REST by moving the rule into a route, which is what
the criterion is guarding.

### Verification

Three new route tests. Mutations, each confirmed to have landed:

| mutation | result |
| --- | --- |
| restore `.max(100_000)` — zod shadows the service again | red |
| `z.unknown()` — drop the type rule with the size rule | red |
| service reports `length: CONTEXT_MD_LIMIT` instead of the real length | red — 2 tests, including the service's own |

The third printed `ANCHOR FAILED` first: `length: input.context_md.length,`
appears twice in `services/projects.ts` — once in the refusal, once in the
activity payload that records how the document grew. Re-anchored on the pair of
lines that is unique.

Added `accepts a document exactly at the limit`, because every assertion above
is about the refusal and a service that refused at `>=` would satisfy all of them.

### The Notes' general question, answered

*"The same shape could exist wherever a zod `.max` shadows a service rule."*
**It does, three more times** — filed as **LAI-159**:

- `heartbeats.ts` loses `repo_length` and `branch_length`, and which of the two
  was too long. Its service comment reads *"Bounded here **as well as** in the
  route"*, which assumes the two coexist when the route always wins.
- `projects.ts`'s `repo` loses the `{ expected: 'owner/name', example }` detail
  that tells a caller the *shape* rather than the size.
- `tasks.ts`'s `tags` loses `count`.

**And one case that is already right, which is what makes the rule statable.**
`tasks.ts` bounds each tag *name* at 64 where `tags.ts` enforces 24 — the route
bound is **looser**, so a 30-character name reaches the service and gets the
message explaining the whole rule. So the fix is not "delete every `.max`": a
route bound may be a sanity guard looser than the service rule, or absent, but
never equal to it, because equal means the service's error can never be seen.

`REPO_MAX_LENGTH` is also declared twice, in `services/heartbeats.ts` and
`services/projects.ts`, both `200`. Noted on LAI-159.

### Gate

`@laika/server` **1742/1742**, `cli` 19/19, `pnpm lint` EXIT=0, `pnpm format`
EXIT=0. `server/web` red on LAI-208's declared assertion only.

The Notes say the client's `readableContextError` workaround should be removed
when this lands — it is `server/web/`, so it is SHELL's, and it is marked with
this task id for them to find.
