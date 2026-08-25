---
id: LAI-077
title: Accept invite screen — match design 5a's right-hand card
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-071, LAI-062]
discovered-from:
status: review
---

## Goal

`/invite` exists as a route with nothing behind it. **LAI-071 builds the API**;
this builds the screen, to design `5a`'s ACCEPT INVITE card.

The screen's whole job is to make one thing unambiguous: **the role was chosen by
whoever invited you, and you cannot change it here.**

## Acceptance criteria

- [x] Card bordered `var(--purb)` — the invite flow is purple where sign-in is
      neutral, so the two are not mistaken for each other.
- [x] **Inviter chip** on `var(--purs)`: their avatar, *"X invited you to Y"*,
      and beneath it in mono the **expiry** (*"expires in 6 days"*).
- [x] **`YOUR ROLE` card**: the role name at 13px/800, a plain-English line of
      what it permits, and a **`PRE-ASSIGNED`** chip. The permission line must
      match §3.1 for that role — do not paraphrase loosely.
- [x] Name and password are editable; **email is locked** — ground `var(--tub)`,
      `var(--tx2)`, with a padlock. The invite is *for* that address.
- [x] Reuse the existing password strength meter from LAI-021.
- [x] Primary action names the org and role: **"Join <Org> as <Role>"**, on
      `var(--pur)`.
- [x] Footer: *"By joining you agree that agent activity under your account is
      attributed to you in the audit log."* — true, and D-007's consequence.
- [ ] **Expired invite** renders the design's own state: clock glyph in
      `var(--amb)`, *"This invite has expired"*, the real expiry window from
      LAI-071, and that the pre-assigned role is kept.
      **NOT MET — see "Two criteria the server will not support" below.**
- [ ] An already-used invite is distinguishable from an expired one. Replay is
      refused server-side; say which happened.
      **NOT MET — same reason. LAI-218 files the decision.**
- [x] Works **with no session** — this is how someone gets one.
- [x] Both themes.

---

## Two criteria the server will not support (AC8, AC9)

Left **unticked** rather than ticked against a partial match.

`services/invites.ts` refuses unknown, expired and already-spent tokens with one
answer, and says why in its own comment: *"Splitting them would confirm to
somebody posting guesses that a token exists."* Measured anonymously against a
running instance:

```
GET  /api/v1/invites/<spent>     404  "That invite is invalid, expired, or already used"
GET  /api/v1/invites/<unknown>   404  "That invite is invalid, expired, or already used"
POST /api/v1/invites/accept      403  "That invite is invalid, expired, or already used"   (replay)
```

Byte-identical. So AC9's *"say which happened"* has nothing to say it from, and
AC8's *"the real expiry window"* does not exist for a refused token — the preview
returns a body only for an invite that is still good.

**What shipped instead:** the design's amber clock and card, headed *"This invite
cannot be used"*, saying the link is *"invalid, expired, or already used"* and
that the pre-assigned role is kept. Truthful about all three, and it does not
name an inviter or an expiry it was never given.

**LAI-218** carries the decision — amend these two criteria, or weaken the
server's answer. That is PM's call, not a builder's, and it is one decision
rather than a defect.

## The other nine, verified on a running instance

Real invites created through `POST /invites`, then opened by token.

| AC | Verified |
| --- | --- |
| 1 · card on `--purb` | `rgba(139,92,246,0.36)` light, `rgba(167,139,250,0.4)` dark — the token both ways. |
| 2 · inviter chip on `--purs` | `rgba(139,92,246,0.11)`. Avatar, *"Ada Lovelace invited you to **Kvelld**"*, `expires in 6 days` in mono — all from the preview. |
| 3 · `YOUR ROLE` card | Role at 13px/800, `PRE-ASSIGNED` chip, permission line from **§3.1**. |
| 4 · email locked | `--tub` ground and `--tx2` text in **both** themes, `readOnly`, padlock. |
| 5 · strength meter | LAI-021's `PasswordInput showStrength`; read "strong" at 20 chars. |
| 6 · action names org and role | *"Join Kvelld as Admin"* on `rgb(139,92,246)` = `--pur`. |
| 7 · audit-log footer | Present, verbatim. |
| 10 · works with no session | **Signed out entirely**, then opened the link: standalone card, no sidebar, real data. `GET /invites/:token` returns `200` with no cookies; `POST /accept` returns `201`. |
| 11 · both themes | Driven through the real theme control. |

**End to end, through the UI:** filled the form on an `admin` link invite and
submitted — account created, **the pre-assigned role was applied** (`org_role:
admin`), session established, landed on `/board` with the new user in the
sidebar. That is the criterion's real point: the role is chosen by the inviter
and the invitee cannot change it.

## Two things the API supports that the criteria do not mention

- **Link invites.** `email` is nullable — a token bound to no address (§4.11).
  There is nothing to lock, so the field is editable with an explanation, and
  the address is sent on accept. Locking a blank field would have been absurd,
  and hiding it would have created an account under an address the person never
  saw. Verified by accepting one anonymously with `curl`.
- **`owner` is invitable.** `POST /invites` takes `z.enum(ORG_ROLES)`, which
  includes `owner`. The old component typed the role as
  `'admin' | 'member' | 'viewer'`, so an owner invite would have looked up
  `undefined` and rendered an empty permission line on the one card whose whole
  job is saying what you are being given. All four roles are covered and a test
  asserts it.

## A defect found in the existing copy

The role descriptions were *"from the prototype's own role descriptions"*, and
the prototype describes a different product:

- **"Cannot change org settings or billing"** — Laika has no billing. No table,
  no endpoint, no mention in the SPEC.
- **"start agent sessions that report presence"** — `heartbeats` has no reader,
  no writer and no route.
- The Member line promised *"Create and move tasks"* as though the **org** role
  granted it. That is §3.2, and only inside a project you belong to. Someone
  accepting a Member invite would have been told they could edit tasks
  everywhere.

Rewritten from §3.1 into `routes/screens/invite-roles.ts`, with tests that fail
on each of those three. Proven: restoring the prototype's Member line turns two
red.
