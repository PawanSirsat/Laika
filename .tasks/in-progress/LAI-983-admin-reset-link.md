---
id: LAI-983
title: 'A person who forgets their password is locked out for good'
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-22T18:22:55Z
---

## Acceptance criteria (D-104 item 4)

- [ ] `POST /api/v1/users/:id/reset-link` → `{ url, expires_at }` shown once;
      single use, ≤ 24 h, hashed at rest; never for the owner unless the
      caller is the owner; logged.
- [ ] A public page/endpoint consumes it to set a new password (validation as
      setup), ends the person's other sessions; expired/used → clear refusal.
- [ ] Rate-limited like sign-in. Named SPEC edits (§3.1 row, §6.1/§6.4 lines).
      Uses better-auth's existing primitives — no new dependency; if one is
      needed, stop and report.
- [ ] Gate; web half LAI-988.
