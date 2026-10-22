---
id: LAI-983
title: 'A person who forgets their password is locked out for good'
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-10-22T18:22:55Z
finished: 2026-10-22T18:44:32Z
---

## Acceptance criteria (D-104 item 4)

- [x] `POST /api/v1/users/:id/reset-link` → `{ url, expires_at }` shown once;
      single use, ≤ 24 h, hashed at rest; never for the owner unless the
      caller is the owner; logged.
- [x] A public page/endpoint consumes it to set a new password (validation as
      setup), ends the person's other sessions; expired/used → clear refusal.
- [x] Rate-limited like sign-in. Named SPEC edits (§3.1 row, §6.1/§6.4 lines).
      Uses better-auth's existing primitives — no new dependency; if one is
      needed, stop and report.
- [x] Gate; web half LAI-988.

## Submitted (CORE, 2026-10-23)

Stacked on LAI-982's head (71984c33), so this branch carries LAI-981 and LAI-982.

- `POST /api/v1/users/:id/reset-link` → `201 { url, expires_at }`. `url` is
  `<LAIKA_PUBLIC_URL>/reset-password?token=…`, shown once; 24 h; SHA-256 at
  rest; an earlier unused link for the same person is revoked. Refusals: `403`
  (no grant, an admin for the owner, any token — session only), `404`, `422
  inactive`.
- **Capability:** new action `user.reset_password`, carried by `manage_people`
  exactly as LAI-981's `user.sign_out`. **LAI-985 moves both to *Deactivate
  people and reset access*.** Never for the owner unless the caller is the
  owner (`can()` on the target's role).
- `POST /api/v1/password-resets/consume {token, new_password}` (public) → `{
  user_id, sessions_ended }`. Password rule is setup's (12–512). Hashed by
  better-auth's configured hasher (`auth.$context.password.hash`) — **no new
  dependency**. Single use by compare-and-swap inside one transaction with
  the password write and ending **every** session of theirs. Refusals: `404
  unknown`, `409 used | revoked | expired`, `403 inactive`, `429` throttled.
- **Rate limited like sign-in:** a `SignInThrottle` of its own, keyed on the
  link's account, or one shared key for unknown tokens (no oracle). Too-short
  passwords are not attempts.
- **Logged without a new verb:** `password_resets` (§4.60, migration
  **0053_password_resets**) is the record of who issued a link for whom and
  whether it was used — the §4.59 `analytics_views` precedent. So this stays
  two-owner, not three.
- **Page:** none server-rendered. The web app has a public route table
  (`/login`, `/invite`, `/setup`), so `/reset-password` is LAI-988's.
- SPEC: §3 grants cell, §3.1 row, §4.60 table, §6.1 paragraph, §6.4 lines.

### Red by design (§4.4) — web half LAI-988 (plus LAI-981/982's)

`pnpm test` exits 1 with the same five as LAI-981/982; this task adds only to
the second:

1. `activity wording covers the server’s vocabulary` — `user.signed_out`, `org.ownership_transferred` (LAI-981/982)
2. `every served endpoint has a caller, or a named reason` — adds `api/v1/password-resets/consume`, `api/v1/users/*/reset-link` to LAI-981/982's three
3. `the stream subscribes to exactly what the server emits` — LAI-981/982's verbs
4. `every server field is visible to the client` — `OrgView.extra_owners`, `UserView.last_seen_at` (LAI-981/982)
5. `describeProjectEvent` — LAI-981/982's verbs
