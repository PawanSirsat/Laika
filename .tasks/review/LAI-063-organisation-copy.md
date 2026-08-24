---
id: LAI-063
title: The Organisation screen says the instance has no owner
area: web
assignee: builder-b
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-08-25T08:15:00+05:30
finished: 2026-08-25T08:30:00+05:30
---

## Goal

`server/web/src/routes/screens/screen-copy.ts:49` gives `/organisation` the
headline **"This instance has no owner yet"** — first boot's copy, pasted.

By the time anyone can reach `/organisation` they are signed in, so an owner
provably exists. The screen tells a signed-in owner that there is no owner.

## Acceptance criteria

- [x] `/organisation` has an empty-state headline that is true of an
      authenticated org-settings screen.
- [x] The body line still says what will live there, as the other placeholders do.
- [x] **Read the whole map while you are in it** — check no other entry borrowed
      its copy from a different screen.

## Notes / context

Trivial to fix; filed because it is exactly the kind of thing that survives to
release. Everything else in that file reads well — the placeholders are honest
about being unbuilt and say what the screen will do, which is the right pattern.

## Notes at review — builder-b

### The reported bug

`/organisation` now reads **"Organisation settings are not built yet"** /
*"Members, invites, roles and the AI provider key live here."* — true of a screen
you can only reach signed in, and still says what will live there. Verified in
the browser, not just in the source.

That headline still says "not built yet", and that is correct: the screen really
is unbuilt (LAI-086). The bug was never the phrase — it was telling a signed-in
owner that the instance had no owner.

### Reading the whole map turned up two more of the same family

Both claim their screen is unbuilt, and both were built weeks of tasks ago:

| path | said | reality |
| --- | --- | --- |
| `/login` | "Sign-in is not built yet … arrives with authentication" | built in LAI-074 |
| `/setup` | "First-run setup is not built yet" | built in LAI-075 / LAI-106 |

Neither is reachable — `AppShell` renders both for real, so the placeholder never
runs — which is exactly why they rotted unnoticed. They now describe the only
situation in which they *could* appear: routing failed, so reload.

### A guard, because copy is a string and nothing knew which screens exist

Added a test that derives the built screens from **`AppShell`'s own
`path === '…'` branches** and fails if any of their copy describes itself as
unbuilt. It stays true as screens land, rather than needing a list kept in step.

Confirmed red by reinstating the original `/login` wording.

**This is the third guard I have added this week whose absence let prose or CSS
rot silently** — the others being the undefined-token check and the
demo-in-bundle check. The pattern is the same each time: **the thing that fails
is not code, so nothing runs it.**
