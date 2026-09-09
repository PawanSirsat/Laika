---
id: LAI-458
title: 'Watching a task and mentioning a person — five served endpoints with no UI'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-094, LAI-143]
discovered-from: LAI-441
status: backlog
---

## Goal

**Five endpoints are built, tested and served, and no part of the product can
reach them:**

```
PUT    /tasks/:id/watch          DELETE /tasks/:id/watch
GET    /tasks/:id/watchers       GET    /watching
GET    /projects/:slug/mentionable
```

LAI-143 and LAI-094 are both `area: server` and both closed. **No UI task was
ever filed.** **D-054** places them; this builds them.

| endpoint | where |
| --- | --- |
| `PUT`/`DELETE /tasks/:id/watch`, `GET /tasks/:id/watchers` | **Task detail** |
| `GET /projects/:slug/mentionable` | **Task detail** — the comment box's `@` |
| `GET /watching` | **the Board**, as a filter |

## Acceptance criteria

- [ ] **A watch toggle on Task detail**, showing the actor's own state, and
      **who else is watching**. Watching is a **write** (D-047, `task.watch`) —
      a Viewer who may read the task may still watch it, because the action is
      granted to every project role. **Test that**: a Viewer's toggle works.
- [ ] **The `@` autocomplete is fed by `GET /projects/:slug/mentionable` and by
      nothing else.** Not the member list, not a client-side filter over it.
      **Assert it**: a fixture where `mentionable` and `members` differ, and the
      autocomplete shows `mentionable`. **This is the criterion most likely to be
      met by accident and wrong** — the member list is already loaded, so the
      shortcut is free and looks identical until somebody is deactivated.
- [ ] **`GET /watching` is a Board filter**, alongside assignee and tag. **Not a
      new screen and not a nav item** (D-054) — a second place that renders task
      cards is a second place for the card to drift.
- [ ] **The toggle is optimistic or it is not** — pick one and be consistent. A
      toggle that flips, then flips back on a refusal, must say why; one that
      waits must not look broken while it waits.
- [ ] **Unwatching a task you do not watch, and watching one you already watch,
      both settle.** Idempotence at the UI is not the server's job to teach the
      user about.
- [ ] Both themes. No demo module. Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**Read D-047 before starting.** *"The server says who is mentionable"* is the
whole point of the `mentionable` endpoint existing at all, and the reason it is
not just the member list: **mentionability is not membership** — a deactivated
member is still a member. Reapplying the rule client-side means two rules, and
the client's is the one that goes stale.

**Do not add a notification centre.** LAI-094's title calls this *"the
notification substrate"*; the substrate is what is built. Anything that consumes
it — a bell, a digest, an unread count — is a separate decision and is not in
this task.
