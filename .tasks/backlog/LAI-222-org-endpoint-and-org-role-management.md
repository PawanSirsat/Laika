---
id: LAI-222
title: No org endpoint, and no way to change an org role or deactivate anyone
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-086
status: backlog
started:
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

---

## Two rulings — CHIEF, 2026-09-01 (D-048)

**1. `user.deactivated` and `user.reactivated`. Two verbs.** Your argument is
right and the LAI-113 test is what distinguishes them from `sprint.tasks_changed`:
that one is single because both directions answer *the same* reader question.
These do not — *"who was locked out, and when"* and *"who was let back in"* are
different questions, and one verb would put the answer in the payload, which is
what the closed vocabulary exists to prevent.

`user.` rather than `member.`: `member.*` is already written by **both**
`invites.ts` (joining the org) and `projects.ts` (project membership).
Deactivation is neither.

**Do not add `depends-on: [LAI-113]`.** These two verbs are not in LAI-113's
seven, so it is not a dependency — it is the same *shape* of two-owner change,
carried the same way. **§4.8's half is written and held**
(`scratchpad/lai-222-spec.patch`) and applied at merge; take the
`ACTIVITY_TYPES` exemption in your own file, or submit red quoting the
`schema-spec-drift` failure (D-045). Either is fine — the exemption is in your
area, so §4.4 step 2 is available.

**2. `GET /api/v1/org` gets a new §3.1 row, `org.read`. Do not borrow
`member_list.read`.**

Your reasoning — *"if you may see who is in the organisation, you may see what it
is called"* — is true, and **it is not what this endpoint returns**. §11.4.2 has
the Organisation screen showing **AI provider configuration: `configured`,
`provider`, `key_last4`**. Whether an org has an LLM provider wired up is not
implied by a member list by any reading.

**The borrow would have been a contingent fact about today's payload, not a
property of the row** — D-037's shape, in a permission matrix, where it is worst:
the next field added to the response inherits a grant nobody reviewed.

- **`org.read`**, granted `✓ ✓ ✓ ✓`, and **a read action** — it belongs in
  `READ_ACTIONS`, so a `read_only` token may call it.
- **The AI provider block is gated separately on `org.settings.edit`**,
  field-level, admin+. No second new action. The response already does
  field-level gating (`ai_api_key` write-only), so this is the pattern the
  endpoint has rather than a new one.
- [ ] A test that a **Viewer** gets the org and **not** the provider block, and
      an Admin gets both. The field-level gate is the whole of this ruling and it
      is the part that silently regresses.

**Your three self-decided calls are all right**, and the first is the one worth
saying so about: **the last-owner guard is one invariant, not two rules.** AC4
and AC5 describing the same trap from two angles is exactly how two code paths
that can disagree get written. An Admin self-demoting being allowed is right for
the reason you give — only Owner-count is unrecoverable — and `avatar_color`
being filed rather than decided is right.
