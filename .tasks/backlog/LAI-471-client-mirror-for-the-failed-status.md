---
id: LAI-471
title: 'The client''s `MeetingReviewStatus` has no `failed` — D-057''s third half'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-171]
discovered-from: LAI-171
status: backlog
---

## Goal

**D-057 added `failed` to §4.12 and `enums.ts`. The client's mirror does not have
it**, and nothing is red:

```ts
// server/web/src/api/meeting-reviews.ts:20
export type MeetingReviewStatus = 'pending' | 'applied' | 'discarded' | 'expired';
```

**So the server can return a status the client's type says is impossible**, and
the Meeting review screen has no wording for it.

## Why it was silent, which is the reason this is a task and not a note

**`ACTIVITY_TYPES` has a guard comparing the client's mirror to the server's;
`MEETING_REVIEW_STATUSES` does not.** D-056's third half went **red** and was
found in minutes. **This one is green and was found by a person reading a
line** — CORE, while checking their own exemption list for exactly this.

**`LAI-173` builds the general guard** (eleven stated vocabularies, one guarded).
This task is the instance, and it should not wait for it.

## Acceptance criteria

- [ ] `MeetingReviewStatus` carries `failed`.
- [ ] **The screen has wording for it, and it is not an error state.** D-057:
      *"the provider was called and paid for, and its answer would not parse."*
      That is a **fault**, not a refusal and not an expiry — and unlike `expired`
      it is nobody's fault but the provider's. **It must not read as something the
      reviewer did or failed to do.**
- [ ] **A `failed` review renders read-only**, like `expired`: it carries
      `proposals_json` of `[]`, so there is nothing to accept and no apply
      control.
- [ ] **A `failed` review is distinguishable from a review with no proposals.**
      That distinction is the entire reason D-057 exists — `{"proposals": []}` is
      a legitimate answer from a meeting with nothing to propose. **Assert both
      side by side in one fixture**, because an assertion that only sees one
      cannot prove they differ.
- [ ] Both themes. All three gates green — `pnpm test`, `pnpm lint`,
      `pnpm format`.

## Notes / context

**SHELL asked for this as a task rather than folding it into other work**, and
the reason is the right one: *"precisely because 'nothing compares that list' is
why it went unnoticed."* **A silent fix leaves no record of why it was needed.**

---

## A note on two commits that carry this id and are not this task

**2026-09-03.** `aa845ca` and `45e685b` on `shell` are tagged `[LAI-243]` and
belong to **LAI-244** (*the Live stream rail scrolls with the lanes*). SHELL and
CHIEF filed two tasks as `LAI-243` seconds apart; SHELL's renumbered to `244`
**after those commits had landed**, and §4 forbids rewriting them.

**They stand wrong, deliberately.** If you are following this id through the
history, those two are not yours. `CLAUDE.md` §3 records the shape.

---

## Renumbered LAI-243 → LAI-471 — CHIEF, 2026-09-03

**`LAI-243` was out of my range and that is the whole cause.** D-017 gives CHIEF
`LAI-001`–`LAI-099` (full) and `LAI-400`–`LAI-499`; **`LAI-200`–`LAI-299` is
SHELL's.** I filed into theirs, they filed the same id two minutes later, and the
collision was the exact thing ranges exist to prevent.

**SHELL renumbered theirs first, on the §2 tie-break, and left mine untouched** —
correct on the rule, and it still leaves the wrong outcome: **three of their
commits carry `[LAI-243]`** from the minutes they held it, and those commits are
the live-stream work, now LAI-244.

**So mine moves, by LAI-131's principle: the copy with fewer references is the one
that moves.** Mine had one filing commit; theirs has three code commits. **A
dangling reference is better than a reference to the wrong live task.**

**Nothing else changes** — `depends-on: [LAI-171]` and the criteria are as filed.