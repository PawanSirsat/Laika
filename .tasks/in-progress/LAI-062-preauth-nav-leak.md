---
id: LAI-062
title: Signed-out pages render the whole authenticated sidebar
area: web
assignee: builder-b
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-08-24T23:15:00+05:30
---

## Goal

**Found by running the app, not by reading code.** On a fresh browser context
with no session, all three pre-auth routes render the full app nav:

```
/login   Board, Timeline, Sprints, Capacity, Dashboard, Meeting review, Tokens, Organisation
/setup   (same eight)
/invite  (same eight)
```

The header on `/setup` reads **"Not signed in"** beside a sidebar offering eight
protected destinations. Every one of them bounces to `/login`.

This is the same mistake as shipping the prototype's `SYSTEM` group, arriving
from the other direction: login, first boot and invite are **pre-auth routes,
not nav destinations** (CLAUDE.md §5.1). They should not carry the app shell.

## Acceptance criteria

- [ ] `/login`, `/setup` and `/invite` render **no application nav** when there
      is no session.
- [ ] A test asserts it, and asserts it **for a signed-out context** — the bug
      is invisible to a test that happens to hold a session. Break it on purpose
      and watch it go red before you trust it.
- [ ] The theme control stays reachable pre-auth. Someone setting up an instance
      at night should not have to sign in to stop being dazzled.
- [ ] The Laika identity (mark and name) stays visible pre-auth — the page should
      still say what it is.
- [ ] Both themes.

## Notes / context

Check what `AppShell` decides on. If the shell is applied by route rather than by
session, a route added later inherits whichever default it happened to get —
prefer a rule that fails safe for new routes.

`/setup` is the one that matters most: it is the very first screen a self-hoster
sees, and it currently offers eight dead links. It is also the M1 exit test.
