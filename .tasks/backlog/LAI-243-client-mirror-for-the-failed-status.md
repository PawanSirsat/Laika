---
id: LAI-243
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
