---
id: LAI-981
title: 'Deactivating someone leaves their tokens and sessions alive, and nobody can sign a person out'
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-10-22T17:13:42Z
finished: 2026-10-22T18:08:03Z
---

## Acceptance criteria (D-104 items 3, plus reads the web needs)

- [x] Deactivation revokes every token and ends every session of the person
      (same transaction); reactivation restores neither. Tests by code.
- [x] `POST /api/v1/users/:id/sign-out` ends all sessions (not tokens) —
      holders of *Deactivate people and reset access* (until LAI-985 lands:
      `user.deactivate`); self allowed; logged.
- [x] `UserView` gains `last_seen_at` (latest session activity) and a
      `GET /api/v1/users/:id/memberships` read (spaces + roles), `can()`
      as profile/member reads.
- [x] Named SPEC edits: §3.1 row for force sign-out, §6.4 lines, §4 note.
- [x] Gate; web halves (LAI-987/988) quoted per §4.4.

## Submitted (CORE, 2026-10-22)

- Deactivation (`setUserActive`, `server/src/services/users.ts`) revokes every
  live token and deletes every session inside one transaction with the flag;
  `user.deactivated` carries `token_ids` and `sessions_ended`. Reactivation
  restores neither.
- `POST /api/v1/users/:id/sign-out` → `{ user_id, sessions_ended }`; new action
  `user.sign_out` (self always; somebody else via `manage_people`, alongside
  `user.deactivate`, until LAI-985). Logged as new verb `user.signed_out`, only
  when a session was ended.
- `UserView.last_seen_at`: the later of `users.last_seen_at` (stamped when
  sessions are ended) and the live sessions' max `updated_at`.
- `GET /api/v1/users/:id/memberships` → `{ data: [{ project_id, slug, name,
  prefix, role, archived, joined_at }] }`, `member_list.read`, narrowed to
  spaces the caller can read.
- Migration **0051_deactivation_ends_access**: `users.last_seen_at`, and the
  `activity` CHECK rebuild for `user.signed_out`.
- SPEC named edits: §3 grants table (*Manage people* carries `user.sign_out`),
  §3.1 row, §4.1 field + note, §4.8 verb list, §6.4 lines. The §3 grants cell
  and the §4.8 verb were needed by the guards; flagged for the reviewer.

### Red by design (§4.4) — the web half, LAI-987 / LAI-988

`pnpm test` exits 1 with exactly these five, all in `server/web/` (SHELL's
lists; no exemption is mine to take):

1. `activity wording covers the server’s vocabulary` — actual `['user.signed_out']`, expected `[]`
2. `every served endpoint has a caller, or a named reason` — `['api/v1/users/*/memberships', 'api/v1/users/*/sign-out']`
3. `the stream subscribes to exactly what the server emits` — server list adds `user.signed_out`
4. `every server field is visible to the client` — `UserView.last_seen_at is served and OrgUser does not declare it`
5. `describeProjectEvent` — unworded verb `user.signed_out`
