---
id: LAI-238
title: An admin cannot see or revoke another user's tokens
area: web
assignee: unclaimed
priority: p3
depends-on: [LAI-459]
discovered-from: LAI-460
status: backlog
---

## Goal

`GET /api/v1/users/:id/tokens` and `DELETE /api/v1/users/:id/tokens/:tokenId`
are served and **called by nothing** (LAI-460).

**This is the one on this list with a security shape.** When somebody leaves, or
a laptop is lost, the only way to revoke that person's agent tokens today is the
API directly. The Tokens screen manages **your own** and nobody else's.

## Acceptance criteria

- [ ] An admin can list and revoke another user's tokens, from the Organisation
      screen where deactivation lives (LAI-459).
- [ ] **The token value is never shown** — prefix, name, last used, and nothing
      else. §4.9 stores a hash and there is nothing to reveal.
- [ ] Revoking is confirmed, and says what breaks: an agent using it stops.
- [ ] LAI-460's exemptions for `api/v1/users/*/tokens` and `.../tokens/*` are
      removed.
- [ ] Full gate `EXIT 0`.

## Notes

`depends-on: [LAI-459]` because it belongs on the screen that task builds.
