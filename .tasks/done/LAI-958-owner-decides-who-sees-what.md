---
id: LAI-958
title: 'Admins can change everyone''s role and nobody can decide who sees what: roles and permissions are not the owner''s alone'
area: server
assignee: core
priority: p1
depends-on: [LAI-885]
discovered-from:
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-22T13:30:29Z
finished: 2026-10-22T14:05:24Z
---

## Goal

D-102 rules 5–6, server half: role changes become owner only, and the owner
grants a fixed set of capabilities per org role.

## Acceptance criteria

- [x] `user.set_role` becomes owner only (admins `403`); invites follow:
      an admin may still invite, but only as `member` or `viewer` — builder
      checks `services/invites.ts` and states the rule in the log.
- [x] Grantable capabilities (each maps to existing actions; builder lists the
      exact mapping in SPEC §3): *See everyone's analytics* (profile.read,
      profile.activity.read, usage.read_people, people.analytics.read from
      LAI-957), *See the organisation's activity history*
      (audit_log.export), *Open every project* (owner/admin implicit lead),
      *Manage people and invites* (user.invite, user.deactivate), *Change
      organisation settings, Time and breaks* (org.settings.edit,
      org.time.set, org.developer_insights.set). Stored per org × role
      (migration); defaults = today's behaviour (admin on, member/viewer off).
- [x] `can()` consults the grant for those actions only; never grantable and
      owner-locked: org.delete, org.transfer_ownership, user.set_role, and the
      new `org.permissions.manage`. Session-only and read-only token rules
      still narrow after a grant.
- [x] `GET /api/v1/org/permissions` (anyone signed in) and
      `PUT /api/v1/org/permissions` (owner only, session) — whole matrix,
      validated, one `member.role_changed`-style audit row (no new activity
      verb unless unavoidable; if unavoidable, say so — it is three owners).
      LAI-885's `GET /api/v1/permissions` reflects grants (its `roles` cells
      and `me.actions` change when a grant changes — test it).
- [x] Tests: matrix tests updated cell by cell for the defaults; a flipped
      grant changes the answer for that role only; owner-locked actions
      cannot be granted (`422`).
- [x] **Named cross-area edit (D-033):** SPEC §3 intro paragraph on grants,
      §3.1 rows changed for `user.set_role` and the new
      `org.permissions.manage` row, §4 table for grants, §6.4 endpoint lines.
      Nothing else in `docs/`.
- [x] Gate: `pnpm test` / `lint` / `format`; web drift failures quoted per
      §4.4 (web half LAI-960).

## Builder notes (CORE, 2026-10-22)

**Branch** `LAI-958-owner-decides-who-sees-what`, from
`integration-owner-visibility-2026-10-22` @691588d0. **Migration `0048_org_role_grants`**
— LAI-955 builds from the same base and will likely take 0048 too; mine is one
`CREATE TABLE` plus one index and regenerates cleanly under the README's
*Two migrations built in parallel* procedure.

**The invite rule** (`services/invites.ts`): `user.invite` now takes the role
the invite grants as `targetOrgRole`. The owner invites any role; anyone else
holding *Manage people and invites* (admin by default) invites as `member` or
`viewer` only. Listing and revoking name no role and need only the grant. The
second `assertCan(actor, 'user.set_role', …)` is gone — `user.set_role` is
owner only, so keeping it would have refused admins every invite.

**Capability → action mapping** (`policy/grants.ts`, SPEC §3's table):

| capability id | label | actions |
| --- | --- | --- |
| `see_people_analytics` | See everyone's analytics | `profile.read`, `profile.activity.read`, `usage.read_people` — LAI-957 adds `people.analytics.read` here |
| `see_org_activity` | See the organisation's activity history | `audit_log.export` |
| `open_all_projects` | Open every project | implicit project role: `lead`; `viewer` for an org viewer (D-006 cap) |
| `manage_people` | Manage people and invites | `user.invite` (member/viewer only), `user.deactivate` |
| `change_org_settings` | Change organisation settings, Time and breaks | `org.settings.edit`, `org.time.set`, `org.developer_insights.set` |

Owner-locked, never grantable: `org.delete`, `org.transfer_ownership`,
`user.set_role`, `org.permissions.manage` (new; session only).
`profile.set_kind`, `profile.rate`, `usage.read_org` and the rest stay
role-only, as the task lists no capability for them.

**Audit row:** no new verb. `member.role_changed`, org-scoped, payload
`{ scope: "org_permissions", from, to }` with the whole matrix each side. The
web's wording for that verb reads *"changed a member's role"*, which is close
but not exact; LAI-960 may want to word the `org_permissions` scope.

**Gate, red by one web assertion only (CLAUDE.md §4.4):**
`pnpm test` exit 1, `pnpm lint` exit 0, `pnpm format` exit 0. Server vitest:
177 files passed, 2 skipped; 3558 tests passed, 10 skipped. cli: 598 pass, 0 fail,
2 skipped. server/web: 2911 tests, 2910 pass, **1 fail**:

```
server/web/test/api/endpoint-coverage.test.ts:255
every served endpoint has a caller, or a named reason
  › no endpoint is served, uncalled and unexplained
served with no caller and no entry in NO_BROWSER_CALLER — build it, or say why not
+ [ 'api/v1/org/permissions' ]
- []
```

That file and `NO_BROWSER_CALLER` are SHELL's; **LAI-960** turns it green by
calling `GET/PUT /org/permissions`. The server census entries for the new view
types (`OrgPermissionsView`, `CapabilityView`, `OwnerLockedView`) sit in
`response-type-coverage.test.ts`'s `UNPAIRED` and expire when LAI-960 pairs
them.

**Also touched, one line:** `services/tasks.ts` `assertMayCloseReview` read
`orgRole === 'owner' || 'admin'` directly; it now asks
`effectiveProjectRole(...) === 'lead'`, so an admin whose *Open every project*
was withdrawn is not still treated as a lead there. LAI-962 works in the same
file from the same base; the hunk is in a different function.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #55, #68.
