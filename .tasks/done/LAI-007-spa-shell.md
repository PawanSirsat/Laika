---
id: LAI-007
title: Wire the SPA shell to the real API — auth, /me, protected routes
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-005, LAI-019, LAI-021]
discovered-from:
status: done
finished: 2026-08-24T07:23:44+05:30
reviewed: 2026-08-24T08:45:00+05:30
started: 2026-08-24T07:01:32+05:30
---

## Goal

Connect the shell that LAI-017…LAI-021 built to the server that LAI-002…LAI-005
built. After this, a human signs in and lands in a real authenticated app.

**Rescoped 2026-08-24.** This task originally covered the whole SPA — scaffold,
theme, routing, states, forms *and* wiring. Those are now LAI-017 through LAI-021
and are API-independent, so they start immediately (D-016). What is left here is
only the part that genuinely needs the API.

## Acceptance criteria

- [x] A typed API client wrapping `fetch`: credentials included, the SPEC §6.3
      error envelope parsed into a typed error, `request_id` surfaced on 5xx.
- [x] Sign-in and sign-out wired to better-auth through LAI-021's login form.
- [x] `GET /api/v1/me` populates the shell's user chrome — name, avatar colour
      derived from id, org role badge.
- [x] Protected routes redirect unauthenticated users to sign-in and return them
      to where they were going after a successful sign-in.
- [x] A `401` anywhere clears client auth state and redirects to sign-in once —
      not a redirect loop, not a silent failure.
- [x] `403` renders LAI-020's permission-denied state, **never** an empty list.
- [x] Loading and error states from LAI-020 are used for the `/me` fetch. A failed
      call never renders a blank page.
- [x] Tests: sign-in → `/me` → sign-out → protected route redirects.

## Notes / context

Milestone: **M1**. SPEC §6.1, §6.3, §11.4. **Builder-B owns `server/web/`** (D-016).

**This task is gated on the API** (CLAUDE.md §5.1) — unlike the shell tasks it
depends on. Board, task and project screens are **not** here; they are Phase 2
and each depends on its own API task per SPEC §11.4.2.

No new dependencies. If a data-fetching library seems necessary, file a task
saying which and why.

---

## Implementation notes for review (Builder-B)

`src/api/` — `client.ts` (the wrapper), `errors.ts` (§6.3 → typed error),
`auth.ts` (better-auth boundary), `me.ts`, `use-session.ts`.
`src/components/` — `UserChrome.tsx`, `ApiErrorState.tsx`. Route table gained a
`public` flag; the shell gained the guard.

### The bug this task actually found

**Sign-out silently did nothing.** `POST /auth/sign-out` with no body sends no
`content-type`, better-auth answers **415**, and because `signOut()` clears local
state in a `finally` the UI went to `/login` looking perfectly correct — while
the session was **still valid on the server**.

Proven before and after, by re-requesting `/me` rather than by trusting the UI:

| | `/me` after "sign out" |
| --- | --- |
| before | **200** — session alive |
| after | **401** — session destroyed |

A sign-out that only pretends is the worst bug this file could have had, and it
is invisible from the screen. `auth.ts` now sends `body: {}` and carries a
comment saying why, and `api.test.ts` asserts a bodied request sets its
`content-type`.

### Verified in a browser against a live server

Seeded a user, then drove the whole flow:

- **Deep link survives the detour** — `/capacity` while anonymous redirected to
  `/login`, and signing in returned to **`/capacity`**, not the board. Same again
  for `/dashboard`.
- **Chrome from `/me`** — name *Ada Lovelace*, role badge *member*, initials
  *AL*, avatar colour derived from the user id (LAI-018), sign-out present.
- **Sign-out** → `/login`, chrome `unauthenticated`, `/me` 401.
- **Wrong credentials** → *"Email or password is wrong."* in `role="alert"`,
  still anonymous, no redirect loop.
- **Dead session** → loading `/tokens` landed on `/login`.

### AC5 and AC6 — how they are covered

**AC5 (one 401, no loop).** The handler is registered once on the client, and
`use-session` guards it with a `probing` ref: `/me` answering 401 on first load
is the *normal anonymous case*, not a session ending, and without that guard the
first probe would trigger "clear and redirect" forever. Unit-tested: one 401
fires the handler exactly once, `403`/`500` never fire it, and the error still
throws so a caller can react too.

I should be straight about one thing: my first attempt to prove this in the
browser used a raw `fetch`, which **bypasses the client the handler lives in**,
so it proved nothing. The mid-session 401 path also cannot be reached through
the UI yet — `/me` on mount is the only call the app makes until Phase 2 screens
exist. That is why it is unit-tested with a stubbed transport rather than
clicked.

**AC6 (403 is never an empty list).** `ApiErrorState` maps a failure onto the
right LAI-020 state — `forbidden` → permission-denied with **no retry**, network
→ retryable error, everything else → error with its `request_id`. Built as a
shared component precisely so Phase 2 screens get it by default rather than each
remembering; the failure it guards against is silent, since a Viewer shown "no
tasks" when tasks exist cannot tell.

### Decisions worth checking

- **No data-fetching library**, as the Notes require. `request()` is ~50 lines.
  The moment to revisit is caching and revalidation across many screens — a task,
  not a quiet install.
- **`NetworkError` is separate from `ApiError`.** An unreachable instance and a
  rejected request have different remedies, and rendering "internal server
  error" for a dropped connection is a lie.
- **An `AbortError` passes through untouched** — a screen unmounting is the
  caller's own doing and must not be reported as the instance being down.
- **Re-read `/me` after sign-in** rather than trusting the sign-in response, so
  there is exactly one definition of the current user.
- **Sign-out clears locally even if the call fails.** A UI that still looks
  signed in is worse — but that is also what hid the 415, so the call is now
  tested rather than trusted.
- **Routes are protected by default**; only `public: true` opts out. Forgetting
  to mark a route leaves it closed rather than open.

### Tests — 19 new, 109 in the package

Real unit tests with a stubbed `fetch`: envelope parsing, `request_id` on 5xx,
unknown-code fallback, non-JSON error bodies, `credentials: 'include'`,
content-type on bodied requests, 204, network vs abort, and the 401 handler.

Confirmed able to fail: removing the 401 handler, switching `credentials` to
`omit`, and dropping `request_id` each turned exactly one case red.

### Gate

`pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm build` pass. `@laika/web`
109/109, `@laika/server` 317/317.

## Review — PM, 2026-08-24

**Accepted.** Held briefly pending the CLAUDE.md §3 log entry, which has now
landed; everything else was verified below at the time of the hold.

Gate green: format, lint, typecheck, **109 web tests** (up from 90) and 322
server. Criteria checked against the code:

| Criterion | Evidence |
| --- | --- |
| Typed client, credentials, §6.3 envelope | `always sends the session cookie`, `the §6.3 envelope is parsed into code, message and details` |
| `request_id` on 5xx | `request_id is surfaced on 5xx so a user can quote it` |
| 401 redirects once, not a loop | `fires the handler exactly once per 401`, `does not fire for other failures` |
| 403 → permission-denied, never empty | `ApiErrorState` returns `<PermissionDenied>` on `code === 'forbidden'` |
| Avatar colour derived from id | `UserChrome` imports `avatarColor`, derived per SPEC §4.1 |

**Outstanding: the CLAUDE.md §3 log entry for this task.** The last entry in
`logs/builder-b-2026-08-24.md` is LAI-021 at 06:52; nothing covers LAI-007.

**Why held rather than sent back.** Your own pattern is `chore(tasks): … to
review` followed by `docs(web): log …` as separate commits, and the second has
not landed yet — bouncing something that may be thirty seconds from arriving
would cost a cycle for nothing. Everything else is verified above, so acceptance
is immediate once the entry exists.

**Why not simply accepted.** The logs have been the single best source of
findings in this project — the `pnpm install` tax, "a stash does not isolate
dependency state", `build.test.ts` passing or failing on whether `server/public/`
exists. Every one of those reached me through a log entry and nowhere else. A
task closed without one loses whatever it learned, and accepting on the grounds
that the code is good is how the rule stops applying whenever the code is good.

**Note:** the branch is already merged into `master` — the code is integrated and
sound. Only the task's closure waits.

### Log entry received — accepted

`logs/builder-b-2026-08-24.md` 07:24. The hold was against the merged state,
where the log commit had not yet arrived; it was written before my review and
landed after it. No fault, and the process worked — the task was not closed
without its record.

**Three decisions in it worth keeping:**

- **Routes are protected by default and opt out with `public: true`.** Forgetting
  to mark a route leaves it *closed* rather than open. Choosing the direction to
  be wrong in is the whole of security defaults, and nothing in the task asked
  for it.
- **`NetworkError` kept separate from `ApiError`.** An unreachable instance and a
  rejected request have different remedies, and reporting "internal server error"
  for a dropped connection is simply false — it sends the user to look for a
  server fault that does not exist.
- **`AbortError` passes through untouched.** A screen unmounting is the caller's
  own doing; turning it into a network error would put a failure state on screen
  after a *successful* navigation. That is the kind of bug that gets reported as
  "it flickers sometimes" and never reproduced.

**LAI-009 is now the last task before M2**, and it depends on LAI-044.
