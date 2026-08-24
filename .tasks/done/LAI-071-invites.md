---
id: LAI-071
title: Invites — send, accept, and the role the invitee lands on
area: server
assignee: builder-a
priority: p1
depends-on: [LAI-010, LAI-060]
discovered-from:
finished: 2026-08-24T19:04:18Z
reviewed: 2026-08-25T14:30:00+05:30
started: 2026-08-24T18:00:58Z
status: done
---

## Goal

**The last unbuilt piece of M2's API.** ROADMAP M2 lists "Invites: send, accept,
roles" and nothing implements it. Laika is invite-only (D-004), so today the
*only* way anyone joins is `POST /api/v1/setup`, which works once. **A
second person cannot be added to a running instance by any means.**

`/invite` exists as a screen and has no endpoint behind it.

## Acceptance criteria

- [x] Create an invite for an email at a named org role, `can()`-gated — inviting
      is not a Member's to do; use the §3.1 cell, and if none fits, say so and
      pick the narrowest.
- [x] List and revoke pending invites.
- [x] Accept an invite: creates the user, lands them on the invited role, and
      **marks the invite used so it cannot be replayed**. Assert the replay is
      refused — a single-use token that is not single-use is the whole risk here.
- [x] Invites **expire**. Pick a window, state the number in the code with its
      reasoning, and test both sides of the boundary.
- [x] The token is high-entropy and **not guessable from the email**; store it
      hashed, exactly as tokens will be in M3.
- [x] Accepting is the one flow that must work **without a session** — it is how
      someone gets one. Check it is not behind the auth middleware.
- [x] Writes `member.added` to `activity` (§4.8 already has the verb).
- [ ] SPEC §6.4 gains the endpoints (D-011).

## Notes / context

**No email is sent.** There is no SMTP in Laika and adding one is not this task —
the invite yields a URL the inviter passes on. Say so in the response shape so
the UI does not imply a message was sent.

Deactivated and already-member cases both need an answer; `409` on the second is
consistent with how membership already behaves.

**This unblocks the member-management screen** (LAI-059) and is what makes the M2
exit test — two humans on two machines — reachable at all.


---

## Builder-A notes (2026-08-25)

**AC8 is left unticked, and its premise is mostly already false.** §6.4 lines
518-519 already list four of the five endpoints — `GET /invites`, `POST /invites`,
`POST /invites/accept` and `GET /invites/:token`. Nothing was needed for those.
Only `DELETE /api/v1/invites/:id` is genuinely missing, and `docs/` is PM's, so it
is filed as **LAI-120** rather than edited. Same shape as LAI-060 AC5 and
LAI-110 AC1.

### The hole that had to be closed for AC3 to mean anything

`POST /api/v1/auth/sign-up/email` is **public** and already accepted an
`inviteToken` — D-004's gate reads it. It validated the invite and then did
nothing else: the invitee landed on the default `member` role and **the token
stayed unspent and reusable for ever**. An accept endpoint that consumed invites
on its own would have left that path exactly as it was, so `POST /invites/accept`
would have been a polite door beside an open window.

The consumption is therefore wired into better-auth's sign-up `after` hook, where
both paths meet, calling `consumeInvite` in `services/invites.ts`. Verified over a
real socket: replaying a spent token is `403` on **both** paths (§6-7 of the
evidence in the log).

### Decisions worth a reviewer's eye

- **`user.invite` governs create, list and revoke** — §3.1's row names one
  capability. Creating additionally asserts `user.set_role` with the target role,
  which is how the row's `(not to Owner)` half is enforced; without it an Admin
  mints an Owner account and the caveat on the direct role change is decorative.
  Proved live: an Admin inviting at `owner` gets 403.
- **Revoke deletes the row.** §4.11 has no `revoked_at` and adding one would put
  `schema.ts` ahead of the spec, which is what LAI-051 exists to catch. An
  accepted invite answers 409 instead — that row is the record of how somebody
  got in.
- **Accept answers 403, the preview answers 404**, and both are uniform across
  unknown/expired/spent. Accepting is an action the token authorises, which is
  what the public sign-up path already answers for the same input; the preview is
  a GET for a resource. Neither distinguishes a real token from a guess.
- **The request logger now redacts `/api/v1/invites/:token`.** §6.4 puts the
  token in the path; hashing it at rest (§4.11) and then printing the plaintext
  into every access log line would undo the hashing, in a file that outlives the
  request. Verified live: zero occurrences of the token in `server.log`.
- **better-auth's `APIError` now maps onto the §6.3 envelope** in
  `http/error-handler.ts`. It is not a Hono exception, so it previously fell
  through to `internal` — a link invite accepted with an already-registered
  address was a 500. `POST /setup` had the same latent gap and is fixed by the
  same branch.

### Not done, deliberately

No `invite.created` / `invite.revoked` activity verbs. §4.8 has none, AC7 asks
only for `member.added`, and PM has asked that the missing-verb wart stop being
filed for now. Recorded here so it is a decision rather than an oversight.

## Review — PM, 2026-08-25

**Accepted.** Verified the whole flow against the built server:

```
create invite            201
unauthenticated preview  200
first sign-up            200
REPLAY same token        403 invite_invalid
```

**Wiring consumption into better-auth's sign-up `after` hook rather than a
separate accept endpoint is the right call, and the reasoning is the valuable
part**: `POST /auth/sign-up/email` already accepted an `inviteToken` and consumed
nothing, so an accept endpoint of its own would have been *"a polite door beside
an open window"*. The bug was the public path, and that is where the fix belongs.

**This makes the M2 exit test reachable.** Until now a second person could not
join a running instance by any means.

**AC8 was my error** — §6.4 already listed four of five endpoints. Third time
I have written "SPEC §X gains this" from the roadmap without opening §6.4.
Unticking it and filing **LAI-120** rather than ticking it is right, and the
habit I need to fix is mine.
