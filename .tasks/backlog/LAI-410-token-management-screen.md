---
id: LAI-410
title: Token management — mint, see once, revoke
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-402]
discovered-from:
status: backlog
---

## Goal

A person cannot point Claude Code at their own board without a token, and there
is nowhere to get one. This is the screen that makes M3 usable by a human rather
than by `curl`.

Lives under `SETTINGS` in the sidebar. Every endpoint it needs is delivered by
LAI-402; nothing here is stubbed and nothing here needs a demo module.

## Acceptance criteria

- [ ] Lists the signed-in user's tokens: name, `prefix`, scope, projects,
      `last_used_at`, `expires_at`, revoked state. Every value comes from
      `GET /api/v1/tokens` — **no hardcoded fixture, ever** (CLAUDE.md §5.1).
- [ ] `last_used_at` renders as a real relative time and reads "never used" when
      null. A token that has never been used is the common case on this screen.
- [ ] Mint: name, scope, optional project narrowing, optional expiry.
- [ ] **The secret is shown exactly once**, in a way that says so unmistakably,
      with a copy control. It is never re-fetchable, and the UI must not imply it
      is. After dismissal it is gone from the DOM and from any client state.
- [ ] A viewer's scope control is **forced to `read_only` and says why**, matching
      the server's behaviour from LAI-402. The UI must not offer a choice the
      server will silently override.
- [ ] Revoke asks for confirmation naming the token, then calls `DELETE`. A
      revoked token stays visible, marked revoked — it is audit history.
- [ ] Empty, loading and error states, using the existing shared primitives.
      Copy an existing screen's states rather than inventing new ones.
- [ ] **Both themes.** A component that only works in light is not done.
- [ ] Rendered in a real browser, both themes, driven through the real theme
      control — not `classList.toggle()`.
- [ ] Full gate green.

## Notes

No new dependencies.

Admin management of **other people's** tokens (`GET /users/:id/tokens`) is
deliberately **not** in this task. It belongs with the org administration screen
that LAI-222 will make possible, and bolting it on here would put an admin
surface inside a personal settings page.
