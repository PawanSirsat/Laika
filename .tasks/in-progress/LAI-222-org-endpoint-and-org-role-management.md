---
id: LAI-222
title: No org endpoint, and no way to change an org role or deactivate anyone
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-086
status: in-progress
started: 2026-09-01T20:25:00Z
finished:
---

## Goal

LAI-086 (the Organisation screen) told me to check `GET /api/v1/org` before
building and to file rather than stub if it was missing. It is missing — and so
is more than the task expected.

**Probed on a running instance, signed in as an `admin`:**

```
GET    /api/v1/org                        404
GET    /api/v1/orgs                       404
PATCH  /api/v1/users/:id                  404
DELETE /api/v1/users/:id                  404
PATCH  /api/v1/users/:id/role             404
POST   /api/v1/users/:id/deactivate       404
```

`app.ts` mounts no org router, and `http/routes/users.ts` has exactly one
handler: `app.get('/')`.

### Two separate holes

**1. The org itself has no endpoint.** SPEC §6.4 lists one; nothing is mounted.
`GET /me` does not carry the org either — it returns `id, email, name, org_role,
is_active, memberships` and no org id or name. So **the signed-in UI cannot
learn which organisation it is looking at.** The only place an org name is
served today is the *pre-auth invite preview*, which needs an invite token.

**2. Org role changes and deactivation do not exist.** SPEC §3.1 gives Owner and
Admin *"Invite users / change org roles"* and *"Deactivate user"*, and the
`users` table carries `org_role` and `is_active`, but no route writes either.

**LAI-086 named LAI-059 as its dependency for this, and LAI-059 built something
else** — *"Project members — list, change role, remove"*, at
`/projects/:slug/members`. That is project-level (§3.2). The org-level
equivalent was never built, and the dependency reads as satisfied because the
titles are so close.

## Acceptance criteria

- [ ] `GET /api/v1/org` returns the caller's organisation — at least id and
      name — and answers `401` when signed out. Mounted in `app.ts`, not merely
      written.
- [ ] Changing another user's `org_role`, gated by `can()` per §3.1: Owner may
      set any role; **Admin may not set or remove Owner**; Member and Viewer may
      not change roles at all.
- [ ] Deactivating and reactivating a user, same gate. `is_active` already
      exists on the row.
- [ ] **The last Owner cannot be demoted or deactivated.** An org with no owner
      is unrecoverable — there is no route back and no console. Refuse with a
      `409` that says why, the way a project refuses to lose its last lead.
- [ ] Nobody can demote or deactivate themselves out of their own last
      privilege — same trap, one actor.
- [ ] Both actions write `member.role_changed` / the appropriate §4.8 activity
      row, so the audit log shows who did it.
- [ ] Tests drive each refusal, and each is proven able to fail.

## Notes

- **Until this lands the Organisation screen is read-only.** LAI-086 ships the
  people list and invite management (both fully served today) and states plainly
  on the screen that role changes need this task, rather than rendering controls
  that 403 or, worse, appear to work.
- The org endpoint is the smaller half and unblocks the screen's header on its
  own. Worth doing first if these are split.
- Whoever takes this: check whether `avatar_color` on the user row is meant to
  be authoritative or derived. The client derives its own from the id
  (`theme/avatar-color.ts`, per SPEC §4.1), so the served column may be dead —
  worth a separate task rather than a silent decision here.
