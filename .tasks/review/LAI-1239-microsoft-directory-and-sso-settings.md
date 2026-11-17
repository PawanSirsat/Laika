---
id: LAI-1239
title: 'Microsoft directory sync (every enabled Member joins) and a Sign-in card on Organisation → Security'
area: server+web+docs
assignee: shell
priority: p1
depends-on: [LAI-1238]
discovered-from: LAI-1238
status: review
started: 2026-11-17T19:00:00Z
finished: 2026-11-17T20:30:00Z
---

## Goal

The owner, after LAI-1238: read all organisation members from Microsoft
(Graph), and then "add sso settings page further". Choices (2026-11-17):
**auto-add everyone**, **app permission** (Graph `User.Read.All`, application),
**enabled Members only** (no guests, no disabled accounts).

Built on LAI-1238 (`LAI-1238-microsoft-sso`, PR #354), same branch.

## Acceptance criteria

- [x] `LAIKA_MICROSOFT_DIRECTORY_SYNC=true|false` (default false); `true`
      without the three SSO variables, or any other value, refuses to start.
- [x] `directory.sync` runs every 15 minutes and at boot (before `hr.sync`,
      which stays last): client-credentials token, `/users` with
      `accountEnabled eq true and userType eq 'Member'` (advanced query,
      `ConsistencyLevel: eventual`), all pages; guests and disabled accounts
      are also filtered here.
- [x] Anyone Laika lacks is added as `member`, no password, one system
      `member.added` row `via: microsoft_directory`; existing people are never
      changed; nothing before first boot; nobody added twice.
- [x] Failures are codes (`graph_forbidden_grant_user_read_all`, `token_401`
      …), never a token, secret or Graph body.
- [x] `GET /api/v1/org/sso` (`org.settings.edit`): sign-in method, tenant and
      client ids, the redirect URI to register; directory sync on/off, interval,
      last run. The client secret is never served.
      `POST /api/v1/org/sso/directory-sync`: Sync now; `409` when off.
- [x] Organisation → Security draws a Sign-in card: read only (SSO is set by
      environment), a copy button on the redirect URI, the last run in words,
      what to fix when it failed, Sync now.
- [x] Guards: the route census names the POST; the response type is paired
      with the client's; SPEC §11.7, compose and env.example carry the
      variable (named crossing, as LAI-1238's).
- [x] Typecheck, lint, format; server and web tests for all of the above.

## Not done (deliberately)

- No deactivation when someone is disabled or removed in Microsoft — the
  owner chose auto-add only. A follow-up if wanted.
- The last run is kept in memory, not stored: the job runs at boot.

## Entra setup for directory sync

API permissions → Add → Microsoft Graph → **Application** permissions →
`User.Read.All` → **Grant admin consent**. Then
`LAIKA_MICROSOFT_DIRECTORY_SYNC=true` and restart.
