---
id: LAI-087
title: A 409 from the setup gate leaves the whole app in a loading skeleton for ever
area: web
assignee: builder-b
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-08-25T05:10:00+05:30
---

## Goal

**The owner hit this and sent a screenshot: every screen a grid of grey skeleton
bars that never resolve.** Reproduced exactly.

`http/middleware/setup-gate.ts` answers **`409 conflict` — "This Laika has not
been set up yet"** for every endpoint except setup, whenever no org exists.
`api/use-session.ts` maps **401 → anonymous** and everything else to
`status: 'error'`. Nothing renders that error, so the app sits in `loading` and
the reader is told nothing at all.

**Repro** — a signed-in tab against an instance whose database is then replaced:

```
signed in            -> /board
database swapped
reload /sprints      -> STILL SKELETONS AFTER 8s
                        failed calls: 409 /api/v1/me
```

**This is not only a developer accident.** It is any browser holding a cookie
against an instance that has been reset, restored from backup, or redeployed on a
fresh volume — and `LAIKA_DB_PATH` pointing somewhere empty is the ordinary
first-run misconfiguration for a self-hoster. They get a dead grey app with no
message.

## Acceptance criteria

- [ ] **A 409 from the setup gate sends the browser to `/setup`.** The server is
      saying "this instance has no org"; the screen that fixes that is first boot.
- [ ] **No non-200 from `/me` may leave the app in `loading`.** Handle the
      general case, not just 401 and 409 — assert that an *unexpected* status
      (say 500) still resolves to a rendered state rather than a skeleton.
- [ ] A stale or invalid session resolves to signed-out and the login screen,
      rather than a shell with a user chip whose data calls all fail.
- [ ] **Test the transition, not just the initial load.** The bug needs an
      authenticated session first and a failing call second; a test that starts
      signed-out passes without touching it.
- [ ] The skeleton has a **ceiling**. If a screen has not resolved in a few
      seconds, render an error state naming what did not load. **A spinner that
      never resolves is worse than an error** — it says "data is coming" when the
      truth is "this will never load", and the reader waits instead of acting.
- [ ] Both themes.

## Notes / context

**The screen-level fix alone is not enough.** Each screen's hook handles its own
fetch, so fixing `use-sprints` leaves the same hole in every other screen. The
ceiling and the `/me` handling belong in the shared session/shell layer where one
fix covers everything.

Worth checking whether `ApiErrorState` (LAI-020) already renders what is needed
and is simply never reached.

Same lesson as the stale nav count in LAI-122, one level up: **the UI is honest
about data it has and silent about data it will never get.** Silence reads as
"working" and is the most expensive kind of wrong.
