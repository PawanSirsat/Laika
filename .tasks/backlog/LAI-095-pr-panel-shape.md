---
id: LAI-095
title: The design's PR panel needs more than `external_ref` holds
area: docs
assignee: unclaimed
priority: p3
depends-on: []
discovered-from:
status: backlog
---

## Goal

Not a gap — a **shape to settle before the webhook work starts**, so it is not
discovered by whoever builds §10.

The design's task detail carries a full pull-request panel:

```
PR #221 · Claim lock on task assignment
lk-142-claim-lock → main · 2 approvals needed
OPEN · CI GREEN
<commit list: sha · author · message · files · +adds · -dels · when>
```

What exists today: **`tasks.external_ref`** — one nullable string, "e.g. a GitHub
PR" (§4.5) — and the activity verbs `webhook.commit` and `webhook.received`
(§4.8). So we can *link* a PR. We cannot render title, branch, base, review
state, CI state, or commits.

## The question

**Does Laika store PR state, or only link to it?**

- **Link only** — `external_ref` is enough; the panel becomes a link and the
  design's detail is dropped. Nothing to build, nothing to keep in sync.
- **Mirror state** — needs somewhere to put branch, base, review and CI status,
  fed by webhooks. Real value on an agent board (an agent can see CI is red
  without leaving), and a real cost: **mirrored state goes stale**, and a board
  confidently showing `CI GREEN` for a run that has since failed is worse than
  showing nothing.

**My recommendation is link-only until someone asks for more.** The commit list
in particular is a lot of storage and sync for something one click away, and it
is the part most likely to be wrong. But it is a product decision.

## Acceptance criteria

- [ ] Decision recorded in `docs/DECISIONS.md` with the reasoning.
- [ ] If link-only: `docs/design/README.md` gains the PR panel's commit list and
      CI badge to its artifacts table, so nobody rebuilds it from the mockup.
- [ ] If mirroring: SPEC §4 and §10 gain the shape, **including how staleness is
      shown** — a mirrored status with no freshness signal is the defect.

## Notes / context

Filed at p3 deliberately. Nothing is blocked on it and §10 is milestones away —
but the answer changes what the webhook work builds, and it is cheaper to settle
now than to discover mid-build.
