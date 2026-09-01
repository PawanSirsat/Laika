---
id: LAI-228
title: The context document's size refusal never names the actual length over REST
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-412
status: backlog
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

- [ ] `PATCH /projects/:slug/context` over the limit returns the **service's**
      error, with `details: { limit, length }`.
- [ ] MCP keeps the same error — the bound lives in the service precisely so
      both entry points agree (LAI-404), and this must not fix REST by moving
      the rule back into a route.
- [ ] A test asserts `details.length` is the **actual** submitted length, not
      the limit. Asserting only the status would pass today.
- [ ] Whatever guard replaces `.max` still refuses a non-string and an absent
      field — dropping the schema rule entirely must not open those.

## Notes

Found while building the context editor (LAI-412). **The client currently reads
both shapes** (`api/project-context.ts`, `readableContextError`) and supplies the
length itself, because it knows what was just typed. That workaround should be
removed when this lands — it is marked with this task id.

Worth a moment on the general pattern: a bound enforced in two layers is
enforced by whichever runs first, and the more informative one lost. The same
shape could exist wherever a zod `.max` shadows a service rule.
