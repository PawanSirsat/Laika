---
id: LAI-062
title: Signed-out pages render the whole authenticated sidebar
area: web
assignee: builder-b
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-08-24T23:15:00+05:30
finished: 2026-08-24T23:40:00+05:30
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

- [x] `/login`, `/setup` and `/invite` render **no application nav** when there
      is no session.
- [x] A test asserts it, and asserts it **for a signed-out context** — the bug
      is invisible to a test that happens to hold a session. Break it on purpose
      and watch it go red before you trust it.
- [x] The theme control stays reachable pre-auth. Someone setting up an instance
      at night should not have to sign in to stop being dazzled.
- [x] The Laika identity (mark and name) stays visible pre-auth — the page should
      still say what it is.
- [x] Both themes.

## Notes / context

Check what `AppShell` decides on. If the shell is applied by route rather than by
session, a route added later inherits whichever default it happened to get —
prefer a rule that fails safe for new routes.

`/setup` is the one that matters most: it is the very first screen a self-hoster
sees, and it currently offers eight dead links. It is also the M1 exit test.

## Notes at review — builder-b

**Reproduced first**, on a real 401 context, exactly as filed: `/login`, `/setup`
and `/invite` each rendered all eight nav links, a nav toggle, and the "Not
signed in" chip.

**The rule is the session, not the route** — the note in this task asked for
something that fails safe for new routes, and gating on a path list is what
cannot. `showsAppNav(session)` lives in `components/shell-chrome.ts`; the shell
has one call site. A new pre-auth screen now gets no nav without anyone
remembering to exclude it, and a protected screen gets none until the session
resolves. `loading` and `error` are closed too: navigation offered before the
session resolves is navigation that may be about to bounce.

It is a **type predicate** rather than a boolean so the single call site still
narrows to the authenticated session the user menu needs. A plain boolean would
have forced a second `status === 'authenticated'` beside it — two rules to keep
in step, which is the shape of the original bug.

**AC2, the signed-out test.** The rule is a function taking a session, so the
test hands it `{ status: 'anonymous' }` directly — no session to accidentally
hold. Beyond the three closed states there is an exhaustive sweep asserting
`authenticated` is the *only* state that passes, so a fifth session state added
later fails here rather than inheriting a default. Three failure modes were
each reintroduced and watched go red: the sidebar rendered unconditionally, the
rule admitting `anonymous`, and the brand removed from the shell.

**AC4 needed a change, not just a check.** The brand lived inside
`<nav aria-label="Primary">`, so removing the nav removed the identity with it.
Extracted to `components/Brand.tsx`; the sidebar and the pre-auth header render
the same one, and it appears exactly once in either state.

**Also removed pre-auth: the "Not signed in" chip.** It is authenticated chrome,
and on a sign-in page it states the obvious beside a form that already says it.

**Verified live on the built app**, signed out (`/me` → 401) and signed in:

| | signed out | signed in |
| --- | --- | --- |
| nav links | 0 | 8 |
| `nav[aria-label="Primary"]` | absent | present |
| nav toggle | absent | present |
| "Not signed in" chip | absent | n/a |
| brand | present, once | present, once |
| theme control | present | present |

Both themes checked through the real toggle on `/login` — page, header, wordmark
and mark all flip, and the theme control stays reachable in both. Driving the
toggle rather than setting `.dk` on the document matters: the latter flips CSS
variables without re-rendering React, which is how the avatar bug fixed in
LAI-059 hid for so long.
