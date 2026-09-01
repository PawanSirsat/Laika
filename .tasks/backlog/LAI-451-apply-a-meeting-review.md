---
id: LAI-451
title: 'POST /meeting-reviews/:id/apply — only what a human accepted'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-450]
discovered-from:
status: backlog
---

## Goal

§10.2's second half, and **the only place in M6 that changes the board**.
`{ accepted_proposal_ids[] }` → apply **exactly those** and nothing else.

## Acceptance criteria

- [ ] **Only accepted proposals apply.** A review with five proposals and two
      accepted ids changes exactly what those two describe — asserted by row
      count and by content, from **both** directions: the two happened, the three
      did not.
- [ ] **An id that is not in this review is refused**, and so is one that was in
      a *different* review. A stable id is only useful if it is checked.
- [ ] **`can()` per proposal, against the applying human**, not once for the
      request. A review may propose changes across tasks the accepter cannot all
      touch, and *"they accepted it"* is not authority. §3.2's rows decide each.
- [ ] **Applying twice does not double.** Idempotent by proposal id, and a test
      that runs it twice.
- [ ] Every applied proposal writes `meeting.applied` (§4.8), with **which
      proposals** in the payload — an audit row saying only *"a meeting was
      applied"* is the one this vocabulary exists to prevent.
- [ ] **A partial failure is not a partial apply.** If proposal three is refused,
      one and two must not have landed — one transaction, and a test that
      forces the refusal.
- [ ] The review's expiry (7 days, §11.6) is respected: an expired review applies
      nothing and says so distinctly from *not found*.
- [ ] Full gate green — **`EXIT 0`**.

## Notes / context

**Reuse the services.** Every proposal maps to something a person can already do
— `updateTask`, `changeStatus`, `createTask`, `updateProjectContext`. **If a
proposal `kind` has no service behind it, that is the finding**: it means the
model can propose something no human path performs, and the answer is to refuse
that `kind` rather than to write a new write path here.

**`decision` proposals may have no board effect at all.** §10.2 lists `decision`
alongside `new`/`change`/`dead`; if accepting one changes nothing, say so — a
proposal kind that silently does nothing is worse than one that is refused.

**This is the task where the whole feature's promise lives.** §10.2: *"Nothing
applies without explicit human acceptance."* Every criterion above is that
sentence in a different place.
