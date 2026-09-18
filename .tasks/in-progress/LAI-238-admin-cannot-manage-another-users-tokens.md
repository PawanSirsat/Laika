---
id: LAI-238
title: An admin cannot see or revoke another user's tokens
area: web
assignee: shell
priority: p2
depends-on: [LAI-459]
discovered-from: LAI-460
started: 2026-09-18T09:14:02+05:30
status: in-progress
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

**Claimed with LAI-459 in `.tasks/review/`, not `.tasks/done/` — §2's letter is
not satisfied and I am saying so rather than letting it pass.** CHIEF accepted
LAI-459 and directed this one next; the hold on it is CORE's two-line LAI-239
edit, which touches nothing this task uses. The rule exists so nobody builds on
work that might be sent back, and that risk is the part CHIEF's acceptance
actually resolves — but the check as written would have said no, so this is a
deviation on CHIEF's call, not a reading in which the dependency was met.

The substance is present regardless: `OrganisationScreen.tsx` and its stylesheet
are on `shell` already, which is what this task extends.
