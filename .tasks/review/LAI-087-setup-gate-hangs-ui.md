---
id: LAI-087
title: A 409 from the setup gate leaves the whole app in a loading skeleton for ever
area: web
assignee: builder-b
priority: p1
depends-on: []
discovered-from:
status: review
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

- [x] **A 409 from the setup gate sends the browser to `/setup`.** The server is
      saying "this instance has no org"; the screen that fixes that is first boot.
- [x] **No non-200 from `/me` may leave the app in `loading`.** Handle the
      general case, not just 401 and 409 — assert that an *unexpected* status
      (say 500) still resolves to a rendered state rather than a skeleton.
- [x] A stale or invalid session resolves to signed-out and the login screen,
      rather than a shell with a user chip whose data calls all fail.
- [x] **Test the transition, not just the initial load.** The bug needs an
      authenticated session first and a failing call second; a test that starts
      signed-out passes without touching it.
- [x] The skeleton has a **ceiling**. If a screen has not resolved in a few
      seconds, render an error state naming what did not load. **A spinner that
      never resolves is worse than an error** — it says "data is coming" when the
      truth is "this will never load", and the reader waits instead of acting.
- [x] Both themes.

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

## Notes at review — builder-b

**Reproduced first**, at the API level and in the browser. `GET /me` on an
instance with no org answers:

```
409 {"error":{"code":"conflict","message":"This Laika has not been set up yet",
     "details":{"setup_required":true,"setup_path":"/setup"}}}
```

The server says exactly what is wrong and where to go. Nothing read it.

**Three fixes, all in the shared layer** so one change covers every screen:

1. **`sessionFromFailure` is total.** Extracted to `api/session-state.ts` and
   tested against every status the server can answer with. The defect was never
   a wrong branch — it was a **missing** one, so the default now maps *anything*
   unrecognised to a rendered error. A test asserts no failure maps back to
   `loading`.
2. **A ceiling on the skeleton.** `load()` resolves for every *answer*, but a
   request that never settles left `loading` true for ever — which is what the
   owner saw. After `SESSION_TIMEOUT_MS` the shell renders a failure instead.
3. **The setup gate is handled globally**, not just on `/me`. A tab open since
   before the instance was reset never re-probes `/me`, so the 409 only reached
   whichever screen happened to fetch — which rendered its own local error while
   the shell carried on believing there was a session. `setSetupRequiredHandler`
   in `client.ts` mirrors the existing 401 handler, so **any** call that hits the
   gate flips the session and the shell redirects to first boot.

**`isSetupRequired` reads the flag, never the message.** Prose gets reworded;
`details.setup_required` is the contract. A test asserts the message alone does
not trigger it, and that an ordinary 409 — "A project must keep at least one
lead" — does not send anyone to first boot.

**Verified** by swapping the database under a live signed-in tab: no skeleton at
any point, and the app resolves to a rendered state every time. Both themes
unaffected — this changes no styling.

**Found while testing, not mine:** Builder-A's sprints screen renders its error
state with **no retry**, so a reader who hits it has no way forward without a
reload. Worth a task.
