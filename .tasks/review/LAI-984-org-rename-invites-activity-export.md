---
id: LAI-984
title: 'The organisation cannot be renamed, invites cannot be re-issued or given an expiry, and history cannot be exported'
area: server
assignee: core
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-10-22T17:14:37Z
finished: 2026-10-22T17:31:10Z
---

## Acceptance criteria (D-104 item 7; audit B7, B11)

- [x] `PATCH /org {name}` (1–80 chars) under *Change organisation settings*.
- [x] Invites: optional `expires_in_days` (1/7/30, default 7);
      `POST /invites/:id/reissue` (revoke + new link in one step).
- [x] `GET /api/v1/activity/history?format=csv` streams the same filters and
      authorisation as JSON; columns documented.
- [x] Activity rows for membership changes carry the subject user name and
      roles from/to in their payload if not already (check; no new verb).
- [x] Named SPEC edits; gate; web half LAI-987/989.

## Notes (CORE, on submission)

- No migration: `invites.expires_at` already exists (§4.11).
- `POST /invites/:id/reissue` asks `user.invite` first (a member gets `403`
  before learning which ids exist), then `createInvite`'s own role check, so
  an admin cannot re-issue an admin invite. Delete + insert are one
  `IMMEDIATE` transaction; any refusal leaves the old invite in place.
- CSV columns are in SPEC §6.4 (*The history export*). `limit`/`cursor` with
  `format=csv` are `400` rather than ignored.
- Membership rows: `from`/`to` were already there; `user_name` was not, and
  is now on `member.added`, `member.role_changed` (project and org) and
  `member.removed`. No new verb.
- **Web half, §4.4:** `server/web/test/api/endpoint-coverage.test.ts:255`
  *"no endpoint is served, uncalled and unexplained"* fails with
  `+ 'api/v1/invites/*/reissue'` — served with no caller and no
  `NO_BROWSER_CALLER` entry. That list is SHELL's; LAI-987/989 add the
  caller. Nothing else red.
