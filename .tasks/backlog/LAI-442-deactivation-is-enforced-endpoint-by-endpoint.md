---
id: LAI-442
title: A deactivated account still signs in, and its session still gets 200s
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-222]
discovered-from: LAI-434
status: backlog
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

- [ ] **A deactivated account cannot sign in.** `POST /auth/sign-in/email`
      answers a distinct, actionable failure — not `200`, and not the same
      message as a wrong password (§6.1's table gains the row). No session is
      issued.
- [ ] **An existing session stops working immediately**, at the resolver rather
      than at each route: reaching any authenticated endpoint with a deactivated
      user's cookie answers `403 forbidden` with *"This account has been
      deactivated"* — **the same answer `/me` already gives**, from one place.
- [ ] `GET /api/v1/projects` with that cookie answers **`403`, not `200 []`**.
      That is the specific regression this task exists to remove, and the one
      test that must exist by name.
- [ ] The token path keeps its current behaviour and a test says so — this must
      converge the two, not replace one with the other.
- [ ] **Reactivation restores access without a new sign-in** if the session has
      not expired, or does not, and a test says which. Do not leave it to be
      discovered.
- [ ] §6.1's table lists the deactivated outcome. **`docs/` is CHIEF's** —
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
