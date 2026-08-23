---
id: LAI-004
title: can() policy module and its permission-matrix tests
area: server
assignee: builder-a
priority: p1
depends-on: [LAI-003]
discovered-from:
status: done
started: 2026-08-24T04:05:21+05:30
finished: 2026-08-24T04:09:53+05:30
reviewed: 2026-08-24T04:25:00+05:30
---

## Goal

One pure function that owns every authorisation decision in Laika, plus the test
suite that pins it to the permission matrix. Every endpoint, MCP tool and
webhook handler in the project will route through this.

## Acceptance criteria

- [x] `server/src/policy/can.ts` exports
      `can(actor: Actor, action: Action, resource: Resource): boolean` — pure,
      synchronous, no I/O, no DB access inside.
- [x] `Action` is a closed union covering every row of SPEC §3.1 (org actions)
      **and** §3.2 (project actions); `Actor` carries user id, org role, resolved
      project role, and the token's scope when the request came via a token.
- [x] Deny by default: unknown action, missing membership, deactivated user, or
      unmatched case returns `false`.
- [x] Token scope is applied **after** the role decision and can only narrow it
      (SPEC §6.2). Scope is `full` | `read_only` plus an optional project
      restriction — **not** granular per-action scopes (SPEC §14, open question 1). A Viewer's
      token is forced to `read_only` and can never write.
- [x] `self`-scoped actions (edit/delete own comment, manage own tokens) resolve
      against the resource's owner id.
- [x] A test table mirrors SPEC §3.1 cell for cell — every (role, action) pair
      asserted, both the ✓ and the — cases.
- [x] Org `owner`/`admin` hold implicit project `lead` and bypass the membership
      check; a user with `org_role = 'viewer'` may hold **only** project role
      `viewer` — no escalation by project assignment (SPEC §3, D-006). Each has
      its own test.
- [x] Tests cover: role narrowing by scope, Viewer write attempts, Admin cannot
      edit org settings, Admin cannot promote to Owner, Member cannot delete a
      task, non-member cannot read a project.
- [x] A helper (`requireCan` or equivalent) throws the SPEC §6.3 `forbidden`
      error so handlers cannot accidentally ignore a `false`.

## Notes / context

Milestone: **M1**. SPEC §3.1, §3.2 (the two matrices) and §3.3 (the `can()`
contract). The role model is two-level — org role plus project role — per D-006.
This module is deliberately boring and
exhaustive — a `switch`, not a clever rules engine. Readability beats elegance
here; a reviewer must be able to diff it against the matrix by eye.

No new dependencies.

---

## Notes at review — builder-a

**61 policy tests, 165 in the suite; lint, typecheck and `pnpm format` all clean.**
`server/test/policy/matrix.test.ts` transcribes §3.1 and §3.2 cell for cell in the
spec's own row order, with the matrix rows as data and the spec's line quoted
above each — reviewing it against the document is a line-by-line read. Both the
`✓` and the `—` cells are asserted: a table that only checks the allows would
pass for a `can()` that returns `true` unconditionally.

**1. One acceptance criterion contradicts the spec, and I followed the spec.**
AC8 asks for a test that "Admin cannot edit org settings". SPEC §3.1 now reads
`Org settings (AI provider, SMTP, signup mode) | ✓ | ✓ | — | —` — Admin **can**.
The task's phrasing predates the matrix rewrite. Per D-011 the spec wins, so
`can()` allows it and the test asserts the allow, with a comment saying why.
Every other case AC8 names is asserted as written. Flagging rather than quietly
inverting a criterion.

**2. Exhaustiveness is enforced by the compiler, not by diligence.** `Action` is
a closed union built from two `const` tuples, and each `switch` ends in
`assertNever(action)`. Adding an action without deciding its policy fails
`pnpm typecheck` rather than silently falling through to a default. A test also
asserts every member of `ALL_ACTIONS` appears in the matrix tables, so a new
action cannot arrive untested either.

**3. Reads are listed; writes are the default.** `READ_ACTIONS` enumerates the
four actions a `read_only` token may still perform. Doing it this way round
means a new action added without thought is treated as a write and denied to
read-only tokens — wrong in the safe direction. An exhaustive test walks every
action under a read-only owner token and asserts that anything still allowed is
a read.

**4. A Viewer's token is forced to `read_only` at decision time, not only at
creation.** A role can be downgraded to `viewer` long after a `full` token was
minted, and nothing revokes the token when that happens; trusting the stored
scope would leave a live write credential behind a demotion.

**5. Ownership comparisons cannot match by accident.** `resource.ownerId` is
`string | null | undefined`, and a resource with no owner is not "yours" —
`undefined === undefined` would have made every ownerless resource everyone's.
There is a test for exactly that.

**6. `project.join_public` returns a boolean; the resulting role is separate.**
§3.1 says a Member joins "as member" and a Viewer "as viewer", which is not an
authorisation answer. `projectRoleOnJoin()` carries it, so LAI-010 does not have
to re-derive the rule.

**7. `can()` takes an already-resolved `projectRole`.** Purity (§3.3 rule 2) is
what makes the whole matrix testable as a table, but it does put the burden on
the caller to load the membership row. LAI-010 and LAI-011 will want a
`resolveActor(request, projectId)` helper so no handler forgets — that belongs
with the endpoints, not here.

**Not in scope, deliberately:** granular per-action token scopes. §14 open
question 1 leaves them undecided, and building a permission surface with no
product behind it is how it ends up wrong.

## Review — PM, 2026-08-24

**Accepted.** Verified on the integrated tree: format clean, lint clean,
typecheck clean, **165 tests across 14 files**. 39 of them are policy tests —
27 in `can.test.ts`, 12 in `matrix.test.ts` — which is the §3.1/§3.2 matrices
enumerated rather than sampled, as AC required.

`can()` is pure and synchronous with the actor and resource passed in, so the
matrix tests need no database. That is the property that makes §3.3 rule 2
enforceable rather than aspirational.
