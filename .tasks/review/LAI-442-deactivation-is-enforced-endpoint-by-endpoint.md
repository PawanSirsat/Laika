---
id: LAI-442
title: A deactivated account still signs in, and its session still gets 200s
area: server
assignee: core
priority: p2
depends-on: [LAI-222]
discovered-from: LAI-434
status: review
started: 2026-09-02T08:05:00Z
finished: 2026-09-02T08:30:00Z
---

## Goal

Found by deactivating a throwaway account on the running instance and then
trying to use it. **Both halves are wrong.**

**It still signs in.** `POST /api/v1/auth/sign-in/email` answers `200` and issues
a session cookie for an account with `is_active = 0`. §6.1's table has three
outcomes and *deactivated* is not one of them, so the user is told nothing and
is handed a working credential.

**And the session reaches endpoints.** Measured, same cookie:

| request | answer |
| --- | --- |
| `GET /api/v1/me` | `403` — *"This account has been deactivated"* ✅ |
| `GET /api/v1/users` | `403` — *"You do not have permission"* — the **role** check, not deactivation |
| `GET /api/v1/projects` | **`200 {"data":[]}`** for an org **admin** |

`/projects` is safe **by accident**: §3.3 rule 3 makes `can()` deny a deactivated
user, so every project is filtered out and the list comes back empty. **The
answer is wrong in shape** — *"you have no projects"* where the truth is *"your
account is switched off"*, which is the LAI-224 / LAI-090 defect a third time.

## Why it matters beyond the message

**Deactivation is enforced endpoint by endpoint rather than at one gate.**
`resolve-actor.ts:95` refuses an inactive user for **token** auth; the cookie
path has no equivalent, and `getCurrentUser` catches it only because `/me` looks
at the field itself. Every other route is relying on each of its own `can()`
calls being right.

**That is a property nobody can check by reading**, and it is exactly the shape
§3.3 rule 1 exists to prevent for authorisation: *one authority, called
everywhere*. Deactivation currently has none.

## Acceptance criteria

- [x] **A deactivated account cannot sign in.** `POST /auth/sign-in/email`
      answers a distinct, actionable failure — not `200`, and not the same
      message as a wrong password (§6.1's table gains the row). No session is
      issued.
- [x] **An existing session stops working immediately**, at the resolver rather
      than at each route: reaching any authenticated endpoint with a deactivated
      user's cookie answers `403 forbidden` with *"This account has been
      deactivated"* — **the same answer `/me` already gives**, from one place.
- [x] `GET /api/v1/projects` with that cookie answers **`403`, not `200 []`**.
      That is the specific regression this task exists to remove, and the one
      test that must exist by name.
- [x] The token path keeps its current behaviour and a test says so — this must
      converge the two, not replace one with the other.
- [x] **Reactivation restores access without a new sign-in** if the session has
      not expired, or does not, and a test says which. Do not leave it to be
      discovered.
- [x] §6.1's table lists the deactivated outcome. **`docs/` is CHIEF's** —  **CHIEF's; no drift test asserts §6.1's table, so no red to quote.**
      quote the drift failure and submit red if one fires (D-045).

## Notes / context

**`is_active` is already loaded** by `resolve-actor` (line 165) for both paths.
The token path throws on it; the cookie path does not. This may be a two-line
change plus its tests — **and the tests are the task**, because the current
behaviour passes every existing one.

**Do not fix it by making `can()` stricter.** `can()` already denies; the defect
is that a request gets that far and then reports the denial as an empty result.
Authentication is where an inactive account stops.

**LAI-222 deliberately kept a deactivated user's rows** so history keeps its
author (§4.1). Nothing here changes that — this is about the live session, not
the record.


---

## Submitted — CORE, 2026-09-02

**1651 server green**, lint and format clean. Web red only on LAI-153, which is
SHELL's and already on `master`.

### The named regression

```
it('answers 403 on GET /api/v1/projects, not 200 with an empty list')
```

It asserts `200` **before** deactivating and `403` after, so it cannot pass
against an endpoint that was broken all along.

### Two changes, and the second is why the first works

`resolveActor` refuses an inactive account on the cookie path — and
`authMiddleware` **rethrows `ApiError` instead of swallowing it**. Without the
second the refusal became `actor: null`, so the answer would have been *"you are
not signed in"*: the same class of wrong answer this task removes one layer down,
reintroduced by the fix. I found that by reading the middleware before writing
the throw, which is the only reason it is not in the diff as a bug.

### Sign-in refuses **after** the password is verified

Refusing before would answer `403` to anyone who typed the address — an
account-existence oracle, and LAI-219 spent a task keeping that property. After
means only somebody who **already proved they hold the credential** learns the
account is off, which they are entitled to know.

A test asserts a *wrong* password on a deactivated account answers exactly as a
wrong password on an unknown address. Mutating the check to run before the
password turns three tests red.

### `403` for a cookie, `401` for a token — deliberate

AC4 says converge, and AC2 says `403`, while the token path answers `401`. Both
hold, because **what converges is the place, not the status**: a refused token is
a bad credential; a valid cookie belonging to a deactivated person is a *good*
credential whose holder may do nothing. Both now stop at the resolver, which is
the property that was missing. Stated in the code and pinned by a test that
asserts both statuses from one deactivation.

### Reactivation: decided, not discovered

**An unexpired session works again immediately, with no new sign-in.**
`loadActor` reads `is_active` from the row on every request rather than trusting
the session payload — which is why deactivation is immediate — and reactivation
is immediate by the same mechanism. Making them asymmetric would mean
invalidating sessions, which nothing does, and would leave a reactivated person
locked out with no way to tell why.

### One guard reported rather than counted

Treating a missing user row as active survives mutation, and is unreachable:
reaching that line requires better-auth to have just verified a password against
a row. Documented as defence in depth. **Five mutations, four caught.**
