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
- [ ] `Action` is a closed union covering every row of SPEC §3.1; `Actor` carries
      user id, org role, resolved project membership role, and optional token
      scopes.
- [ ] Deny by default: unknown action, missing membership, deactivated user, or
      unmatched case returns `false`.
- [ ] Token scopes are applied **after** the role decision and can only narrow it
      (SPEC §6.2) — a Viewer's token with `tasks:write` still cannot write.
- [ ] `self`-scoped actions (edit/delete own comment, manage own tokens) resolve
      against the resource's owner id.
- [ ] A test table mirrors SPEC §3.1 cell for cell — every (role, action) pair
      asserted, both the ✓ and the — cases.
- [ ] Tests cover: role narrowing by scope, Viewer write attempts, Admin cannot
      edit org settings, Admin cannot promote to Owner, Member cannot delete a
      task, non-member cannot read a project.
- [ ] A helper (`requireCan` or equivalent) throws the SPEC §6.3 `forbidden`
      error so handlers cannot accidentally ignore a `false`.

## Notes / context

Milestone: **M1**. SPEC §3.1 and §3.2. This module is deliberately boring and
exhaustive — a `switch`, not a clever rules engine. Readability beats elegance
here; a reviewer must be able to diff it against the matrix by eye.

No new dependencies.
