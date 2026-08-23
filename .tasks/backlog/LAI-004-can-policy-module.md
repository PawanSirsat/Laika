---
id: LAI-004
title: can() policy module and its permission-matrix tests
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-003]
discovered-from:
status: backlog
---

## Goal

One pure function that owns every authorisation decision in Laika, plus the test
suite that pins it to the permission matrix. Every endpoint, MCP tool and
webhook handler in the project will route through this.

## Acceptance criteria

- [ ] `server/src/policy/can.ts` exports
      `can(actor: Actor, action: Action, resource: Resource): boolean` — pure,
      synchronous, no I/O, no DB access inside.
- [ ] `Action` is a closed union covering every row of SPEC §3.1 (org actions)
      **and** §3.2 (project actions); `Actor` carries user id, org role, resolved
      project role, and the token's scope when the request came via a token.
- [ ] Deny by default: unknown action, missing membership, deactivated user, or
      unmatched case returns `false`.
- [ ] Token scope is applied **after** the role decision and can only narrow it
      (SPEC §6.2). Scope is `full` | `read_only` plus an optional project
      restriction — **not** granular per-action scopes (SPEC §14, open question 1). A Viewer's
      token is forced to `read_only` and can never write.
- [ ] `self`-scoped actions (edit/delete own comment, manage own tokens) resolve
      against the resource's owner id.
- [ ] A test table mirrors SPEC §3.1 cell for cell — every (role, action) pair
      asserted, both the ✓ and the — cases.
- [ ] Org `owner`/`admin` hold implicit project `lead` and bypass the membership
      check; a user with `org_role = 'viewer'` may hold **only** project role
      `viewer` — no escalation by project assignment (SPEC §3, D-006). Each has
      its own test.
- [ ] Tests cover: role narrowing by scope, Viewer write attempts, Admin cannot
      edit org settings, Admin cannot promote to Owner, Member cannot delete a
      task, non-member cannot read a project.
- [ ] A helper (`requireCan` or equivalent) throws the SPEC §6.3 `forbidden`
      error so handlers cannot accidentally ignore a `false`.

## Notes / context

Milestone: **M1**. SPEC §3.1, §3.2 (the two matrices) and §3.3 (the `can()`
contract). The role model is two-level — org role plus project role — per D-006.
This module is deliberately boring and
exhaustive — a `switch`, not a clever rules engine. Readability beats elegance
here; a reviewer must be able to diff it against the matrix by eye.

No new dependencies.
