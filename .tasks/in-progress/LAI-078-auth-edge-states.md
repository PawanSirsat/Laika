---
id: LAI-078
title: Auth error and connection states
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-074]
discovered-from:
status: in-progress
started: 2026-08-25T01:55:04Z
---

## Goal

The `ERROR & EDGE STATES` column of design `5a`. These are the states people
actually hit, and they are currently generic.

## Acceptance criteria

- [ ] **Wrong credentials**: the email field re-borders `var(--redb)` on
      `var(--reds)`, with a message in `var(--red)` at 11px/600 beside an alert
      glyph.
- [ ] **Do not invent a lockout counter.** The mockup says *"3 attempts left
      before a 15-minute lockout"*. Show a countdown **only if the server
      actually returns attempts and a lockout window** — check what better-auth
      is configured to do. If it does not, say so plainly without a number, and
      file a task for the server side rather than faking it.
- [ ] **Instance unreachable**: the design's offline card — *"The board keeps
      working offline for reading. Live updates resume when the SSE stream
      reconnects."* — with the retry attempt and countdown in mono.
- [ ] The retry line shows the **real** reconnect state from the SSE client
      (LAI-070), not a fixed string. If LAI-070 has not landed, show the state
      without a countdown.
- [ ] The message never reveals whether an email exists — *"Email or password is
      wrong"* is deliberate.
- [ ] Both themes.

## Notes / context

The offline card is worth building properly: it is the difference between a board
that looks broken and one that says it is degraded but readable. That claim must
be **true** — if the SPA cannot in fact read while offline, change the copy to
match reality rather than shipping the aspiration.
