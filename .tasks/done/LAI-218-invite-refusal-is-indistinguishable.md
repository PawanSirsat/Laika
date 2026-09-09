---
id: LAI-218
title: Decide whether an expired invite may be told apart from a used one
area: docs
assignee: chief
priority: p2
depends-on: []
discovered-from: LAI-077
status: done
started: 2026-09-02T19:05:00Z
finished: 2026-09-02T19:20:00Z
---

## Goal

**This is a decision, not an implementation.** LAI-077 has two acceptance
criteria that cannot be met as written, and the reason is a deliberate security
property rather than a gap:

> AC8 — *Expired invite renders the design's own state: clock glyph in
> `var(--amb)`, "This invite has expired", **the real expiry window from
> LAI-071**, and that the pre-assigned role is kept.*
>
> AC9 — *An already-used invite is distinguishable from an expired one. Replay
> is refused server-side; **say which happened**.*

`services/invites.ts` refuses all three cases — unknown, expired, already-spent —
with one answer, and says why in its own comment:

> *"Unknown, expired and already-spent are one indistinguishable answer in both
> functions. Splitting them would confirm to somebody posting guesses that a
> token exists, which is the only thing worth learning here."*

Measured on a running instance, anonymously:

```
GET  /api/v1/invites/<spent token>    404  "That invite is invalid, expired, or already used"
GET  /api/v1/invites/<unknown token>  404  "That invite is invalid, expired, or already used"
POST /api/v1/invites/accept (replay)  403  "That invite is invalid, expired, or already used"
```

Byte-identical. The client has nothing to branch on, and for a refused token
there is no `expires_at` to display either — the preview returns a body only for
an invite that is still good.

## The three ways out

1. **Amend AC8 and AC9** — the screen says "invalid, expired, or already used"
   in the design's expired styling, which is what LAI-077 shipped. Truthful,
   slightly less helpful, no server change. **My recommendation.**
2. **Split the answers server-side** — distinct codes for expired vs used.
   Turns `GET /invites/:token` into an oracle: post a guess, and a `410` rather
   than a `404` confirms the token is real. Tokens are high-entropy, so this is
   not fatal, but it is a real reduction for a cosmetic gain.
3. **Split only for a token that was valid recently** — e.g. tell someone their
   invite expired only if it expired in the last N days. Narrower oracle, but
   still an oracle, and more code on a security path than either alternative.

## What was actually built

The refused state renders the design's amber clock and card and says the link is
*"invalid, expired, or already used"*, with "your pre-assigned role is kept". It
does **not** name the inviter or an expiry window, because for a refused token
the server sends neither and inventing them would be fiction.

AC8 and AC9 were left **unticked** in LAI-077 rather than ticked against a
partial match.

## Acceptance criteria

- [x] A decision is recorded in `docs/DECISIONS.md` — **D-053**, with the oracle
      trade-off stated either way **and the argument that actually settled it**:
      Laika sends no mail, so every invite was handed over by a person who is
      still there to ask.
- [x] **Option 1.** LAI-077's AC8 and AC9 amended and ticked, with the struck
      text left visible so the change is legible rather than silent.
- [x] **Not applicable — options 2 and 3 are declined, not deferred.** No task
      is filed against `server/`. D-053 records what would reopen it instead.

## Notes

- `area: docs` because the first step is a decision only CHIEF can take. Whichever
  way it goes, the code change belongs to a different task and a different area.
- The design (`5a`) shows "This invite has expired" and names the inviter, so
  choosing option 1 means the shipped screen deliberately differs from the
  design. That is worth writing down where someone comparing the two will find
  it — `docs/design/README.md` already carries a list of exactly this kind.

---

## Decided — CHIEF, 2026-09-02 → **D-053, option 1**

**Your recommendation, and the write-up did the work** — three options, each with
its cost stated, and the measurement that proves the current behaviour rather
than a description of it. **The AC8/AC9 pair left unticked rather than ticked
against a partial match** is what made this a decision instead of a discrepancy
somebody would find later.

### One thing I added, and it is why this is not a close call

**Laika sends no mail.** `smtp_json_enc` is a declared column with a
`SecretPurpose` slot and **nothing writes it and nothing reads it** — there is no
`sendMail` in `server/src/` at all. `services/invites.ts` says it plainly:

> *"An invite yields a URL and the inviter passes it on themselves."*

**So every invite in Laika was handed over by a person, and that person is still
there.** The recovery path for *"my link stopped working"* is to ask them — a
channel that is open, already trusted, and answers the exact question the screen
is being asked to answer. **Splitting the server's answers buys a worse version
of a conversation that is already available.**

On the oracle trade-off alone this could have gone either way, as you said. That
is the part that closes it.

### And what would reopen it, recorded rather than left to be rediscovered

If §12's invite mail ever lands, the better shape is **neither** option: the
screen offers *"ask for a new link"*, posting the token re-sends to the bound
address **if and only if the invite was real**, and answers identically either
way. **The poster learns nothing; the holder gets helped** — the password-reset
shape, which resolves the trade-off instead of picking a side of it. In D-053, so
whoever builds §12 finds it.

**The design divergence is in `docs/design/README.md`**, in the artifacts table,
where someone comparing the screen to `5a` is actually looking — marked as a
divergence with a reason rather than an omission.
