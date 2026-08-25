---
id: LAI-077
title: Accept invite screen — match design 5a's right-hand card
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-071, LAI-062]
discovered-from:
status: in-progress
---

## Goal

`/invite` exists as a route with nothing behind it. **LAI-071 builds the API**;
this builds the screen, to design `5a`'s ACCEPT INVITE card.

The screen's whole job is to make one thing unambiguous: **the role was chosen by
whoever invited you, and you cannot change it here.**

## Acceptance criteria

- [ ] Card bordered `var(--purb)` — the invite flow is purple where sign-in is
      neutral, so the two are not mistaken for each other.
- [ ] **Inviter chip** on `var(--purs)`: their avatar, *"X invited you to Y"*,
      and beneath it in mono the **expiry** (*"expires in 6 days"*).
- [ ] **`YOUR ROLE` card**: the role name at 13px/800, a plain-English line of
      what it permits, and a **`PRE-ASSIGNED`** chip. The permission line must
      match §3.1 for that role — do not paraphrase loosely.
- [ ] Name and password are editable; **email is locked** — ground `var(--tub)`,
      `var(--tx2)`, with a padlock. The invite is *for* that address.
- [ ] Reuse the existing password strength meter from LAI-021.
- [ ] Primary action names the org and role: **"Join <Org> as <Role>"**, on
      `var(--pur)`.
- [ ] Footer: *"By joining you agree that agent activity under your account is
      attributed to you in the audit log."* — true, and D-007's consequence.
- [ ] **Expired invite** renders the design's own state: clock glyph in
      `var(--amb)`, *"This invite has expired"*, the real expiry window from
      LAI-071, and that the pre-assigned role is kept.
- [ ] An already-used invite is distinguishable from an expired one. Replay is
      refused server-side; say which happened.
- [ ] Works **with no session** — this is how someone gets one.
- [ ] Both themes.
