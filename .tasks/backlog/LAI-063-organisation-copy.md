---
id: LAI-063
title: The Organisation screen says the instance has no owner
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from:
status: backlog
---

## Goal

`server/web/src/routes/screens/screen-copy.ts:49` gives `/organisation` the
headline **"This instance has no owner yet"** — first boot's copy, pasted.

By the time anyone can reach `/organisation` they are signed in, so an owner
provably exists. The screen tells a signed-in owner that there is no owner.

## Acceptance criteria

- [ ] `/organisation` has an empty-state headline that is true of an
      authenticated org-settings screen.
- [ ] The body line still says what will live there, as the other placeholders do.
- [ ] **Read the whole map while you are in it** — check no other entry borrowed
      its copy from a different screen.

## Notes / context

Trivial to fix; filed because it is exactly the kind of thing that survives to
release. Everything else in that file reads well — the placeholders are honest
about being unbuilt and say what the screen will do, which is the right pattern.
