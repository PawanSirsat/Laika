---
id: LAI-982
title: 'The role picker can make a second owner and there is no way to transfer ownership'
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-10-22T18:10:05Z
finished: 2026-10-22T18:18:59Z
---

## Acceptance criteria (D-104 item 2)

- [x] `PATCH /users/:id {org_role: 'owner'}` refused `422` (`use_transfer`).
- [x] `POST /api/v1/org/transfer-ownership {user_id, confirm}` — owner only,
      session only, active admin/member target; target becomes owner, caller
      admin, `orgs.owner_user_id` updated, one transaction, logged.
- [x] Startup/health or a read reports when more than one owner exists
      today (no silent demotion); test.
- [x] Named SPEC edits: §3.1 transfer row, §6.4 lines. Gate; web half LAI-987.

## Submitted (CORE, 2026-10-22)

Built on LAI-981's head (50d8367b), so this branch carries LAI-981 too.

- `PATCH /users/:id {org_role:'owner'}` → `422`, `details.reason: 'use_transfer'`.
  Also `422 use_transfer`: demoting or deactivating the owner
  `orgs.owner_user_id` names (otherwise, with a pre-D-104 second owner, the
  org could record an owner who is not one). Demoting an *extra* owner stays
  allowed — that is how one is put right.
- **Invites checked:** the owner could invite an `owner`; now `422 use_transfer`.
- `POST /api/v1/org/transfer-ownership {user_id, confirm}` → `{ owner,
  previous_owner }` (two `UserView`s). Owner only, **session only** (added to
  `SESSION_ONLY_ACTIONS`); target active admin or member; `confirm` is the
  target's email (case/space-insensitive). Refusals: `422` reasons `self`,
  `inactive`, `role` (viewer), `confirm_mismatch`. Three writes in one
  `db.transaction`; logged as new verb `org.ownership_transferred`
  `{ from_user_id, to_user_id, to_previous_role }`.
- **Extra owners reported, not demoted:** `GET /org` adds `extra_owners: [{ id,
  name, email }]` for a caller passing `org.transfer_ownership` (the owner,
  signed in).
- Migration **0052_one_owner**: the `activity` CHECK rebuild for the verb.
- SPEC: §3.1 row split into *Delete org data* and *Transfer ownership* (session
  only); §6.4 lines (org, transfer, users, invites); §4.8 verb (needed by the
  guards — flagged).

### Red by design (§4.4) — web half LAI-987 (plus LAI-981's, still pending)

`pnpm test` exits 1 with exactly five, all in `server/web/`:

1. `activity wording covers the server’s vocabulary` — `['user.signed_out', 'org.ownership_transferred']`
2. `every served endpoint has a caller, or a named reason` — `api/v1/org/transfer-ownership`, `api/v1/users/*/memberships`, `api/v1/users/*/sign-out`
3. `the stream subscribes to exactly what the server emits` — server list adds both verbs
4. `every server field is visible to the client` — `OrgView.extra_owners` / `Org`; `UserView.last_seen_at` / `OrgUser`
5. `describeProjectEvent` — `user.signed_out`, `org.ownership_transferred`
