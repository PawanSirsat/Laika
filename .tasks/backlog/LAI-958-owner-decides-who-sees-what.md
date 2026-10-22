---
id: LAI-958
title: 'Admins can change everyone''s role and nobody can decide who sees what: roles and permissions are not the owner''s alone'
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-885]
discovered-from:
status: backlog
---

## Goal

D-102 rules 5–6, server half: role changes become owner only, and the owner
grants a fixed set of capabilities per org role.

## Acceptance criteria

- [ ] `user.set_role` becomes owner only (admins `403`); invites follow:
      an admin may still invite, but only as `member` or `viewer` — builder
      checks `services/invites.ts` and states the rule in the log.
- [ ] Grantable capabilities (each maps to existing actions; builder lists the
      exact mapping in SPEC §3): *See everyone's analytics* (profile.read,
      profile.activity.read, usage.read_people, people.analytics.read from
      LAI-957), *See the organisation's activity history*
      (audit_log.export), *Open every project* (owner/admin implicit lead),
      *Manage people and invites* (user.invite, user.deactivate), *Change
      organisation settings, Time and breaks* (org.settings.edit,
      org.time.set, org.developer_insights.set). Stored per org × role
      (migration); defaults = today's behaviour (admin on, member/viewer off).
- [ ] `can()` consults the grant for those actions only; never grantable and
      owner-locked: org.delete, org.transfer_ownership, user.set_role, and the
      new `org.permissions.manage`. Session-only and read-only token rules
      still narrow after a grant.
- [ ] `GET /api/v1/org/permissions` (anyone signed in) and
      `PUT /api/v1/org/permissions` (owner only, session) — whole matrix,
      validated, one `member.role_changed`-style audit row (no new activity
      verb unless unavoidable; if unavoidable, say so — it is three owners).
      LAI-885's `GET /api/v1/permissions` reflects grants (its `roles` cells
      and `me.actions` change when a grant changes — test it).
- [ ] Tests: matrix tests updated cell by cell for the defaults; a flipped
      grant changes the answer for that role only; owner-locked actions
      cannot be granted (`422`).
- [ ] **Named cross-area edit (D-033):** SPEC §3 intro paragraph on grants,
      §3.1 rows changed for `user.set_role` and the new
      `org.permissions.manage` row, §4 table for grants, §6.4 endpoint lines.
      Nothing else in `docs/`.
- [ ] Gate: `pnpm test` / `lint` / `format`; web drift failures quoted per
      §4.4 (web half LAI-960).
