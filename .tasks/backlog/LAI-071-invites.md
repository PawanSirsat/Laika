---
id: LAI-071
title: Invites — send, accept, and the role the invitee lands on
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-010, LAI-060]
discovered-from:
status: backlog
---

## Goal

**The last unbuilt piece of M2's API.** ROADMAP M2 lists "Invites: send, accept,
roles" and nothing implements it. Laika is invite-only (D-004), so today the
*only* way anyone joins is `POST /api/v1/setup`, which works once. **A
second person cannot be added to a running instance by any means.**

`/invite` exists as a screen and has no endpoint behind it.

## Acceptance criteria

- [ ] Create an invite for an email at a named org role, `can()`-gated — inviting
      is not a Member's to do; use the §3.1 cell, and if none fits, say so and
      pick the narrowest.
- [ ] List and revoke pending invites.
- [ ] Accept an invite: creates the user, lands them on the invited role, and
      **marks the invite used so it cannot be replayed**. Assert the replay is
      refused — a single-use token that is not single-use is the whole risk here.
- [ ] Invites **expire**. Pick a window, state the number in the code with its
      reasoning, and test both sides of the boundary.
- [ ] The token is high-entropy and **not guessable from the email**; store it
      hashed, exactly as tokens will be in M3.
- [ ] Accepting is the one flow that must work **without a session** — it is how
      someone gets one. Check it is not behind the auth middleware.
- [ ] Writes `member.added` to `activity` (§4.8 already has the verb).
- [ ] SPEC §6.4 gains the endpoints (D-011).

## Notes / context

**No email is sent.** There is no SMTP in Laika and adding one is not this task —
the invite yields a URL the inviter passes on. Say so in the response shape so
the UI does not imply a message was sent.

Deactivated and already-member cases both need an answer; `409` on the second is
consistent with how membership already behaves.

**This unblocks the member-management screen** (LAI-059) and is what makes the M2
exit test — two humans on two machines — reachable at all.
