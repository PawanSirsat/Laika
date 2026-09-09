---
id: LAI-451
title: 'POST /meeting-reviews/:id/apply — only what a human accepted'
area: server
assignee: core
priority: p2
depends-on: [LAI-450]
discovered-from:
status: done
started: 2026-09-09T14:50:00Z
finished: 2026-09-09T17:25:00Z
---

## Goal

§10.2's second half, and **the only place in M6 that changes the board**.
`{ accepted_proposal_ids[] }` → apply **exactly those** and nothing else.

## Acceptance criteria

- [x] **Only accepted proposals apply.** A review with five proposals and two
      accepted ids changes exactly what those two describe — asserted by row
      count and by content, from **both** directions: the two happened, the three
      did not.
- [x] **An id that is not in this review is refused**, and so is one that was in
      a *different* review. A stable id is only useful if it is checked.
- [x] **`can()` per proposal, against the applying human**, not once for the
      request. A review may propose changes across tasks the accepter cannot all
      touch, and *"they accepted it"* is not authority. §3.2's rows decide each.
- [x] **Applying twice does not double.** Idempotent by proposal id, and a test
      that runs it twice.
- [x] Every applied proposal writes `meeting.applied` (§4.8), with **which
      proposals** in the payload — an audit row saying only *"a meeting was
      applied"* is the one this vocabulary exists to prevent.
- [x] **A partial failure is not a partial apply.** If proposal three is refused,
      one and two must not have landed — one transaction, and a test that
      forces the refusal.
- [x] The review's expiry (7 days, §11.6) is respected: an expired review applies
      nothing and says so distinctly from *not found*.
- [x] Full gate green — **`EXIT 0`**.

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

---

## Submission note — CORE, 2026-09-09

**Root gate `EXIT 0`**: server 103 files / 1889 tests, `server/web` 644, `cli`
72; lint, format and typecheck clean.

### AC3 — `can()` per proposal, and why there is no permission table here

Each proposal calls the service a person would have called, and each of those
runs its own `assertCan` against the applying human. §3.2's rows decide each
change; nothing in this file has a second opinion to drift from them.

The case that makes it concrete and testable: **`meeting_proposal.apply` is
member-and-up, but a `decision` writes `context_md`, which §3.2 makes
lead-only.** So a member may apply one proposal in a review and be refused
another. The test asserts all three legs — member applies the task change,
member is refused the decision, **owner applies the same decision** — so the
refusal is provably about the role and not about the proposal being unapplicable.

### AC5 — one row for the set, and why

The criterion reads *"**Every applied proposal** writes `meeting.applied` … with
**which proposals** in the payload"*, and those clauses point opposite ways.
**§4.8 decides it, not my preference:** `sprint.tasks_changed` is *"one verb for
both directions"* for a set operation *"and the payload carries which"* — the
identical shape. §4.8's own stated test is *"could a reader answer 'when did this
happen?' without inspecting a payload?"*, which one row passes.

**Say so in review if you meant per-proposal rows.** It is a small change and the
argument for it is real — a row per proposal would carry `task_id` and land on
the task's own timeline, where somebody asks *"why did this move?"*.

### The task file's open question, answered by the spec

Notes: *"`decision` proposals may have no board effect at all … if accepting one
changes nothing, say so."* **They do have one.** §11.4.2: *"Accepted `decision`
proposals from a meeting diff append to it with the date. That is the mechanism
that keeps it current instead of stale."* So it appends to `context_md`, and the
shape is pinned by test: one `## Decisions` heading created once, one list across
meetings, an ISO day rather than a locale.

Every `kind` has a service behind it, so the Notes' *"if a kind has no service,
that is the finding"* did not fire.

### AC6 — break-probes, seven, all red

Anchor asserted present before each run and the file checksummed back after.

| mutation | result |
| --- | --- |
| apply every proposal, ignoring accepted ids | red (3 tests) |
| stop checking an id belongs to this review | red |
| `decision` writes `context_md` directly, not via the service | red |
| do not stamp `applied_at` | red |
| audit payload becomes a count | red |
| no transaction around the set | red (5 tests, incl. the partial-failure one) |
| trust `status` only, ignore the clock | red (2 tests) |

The transaction probe is worth a note: the harness printed only the first three
failures, and **the partial-failure test — the one AC6 rests on — was below the
cut.** Re-ran it printing everything to confirm it was really red rather than
assuming from the three that showed.

### Found while doing this

**LAI-045's guard caught this code.** The `meeting.applied` payload named
`taskId`; the sweep went red with `meeting.applied: "taskId"`. Fixed to
`task_id`, and the sweep now exercises the new emitter — which
`activity-payload-names.test.ts` required before it would go green, along with
`structure.test.ts` requiring the mirrored route test.

### Not in scope, deliberately

The two GETs and `discard` are **LAI-454**. The route file exists with one
endpoint and says in its docblock that LAI-454's land beside it.

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** Root gate `EXIT 0` — server **1889**, web 644, cli 72. All eight
criteria ticked and all eight hold.

**Three mutations here**, `meeting-reviews.ts` checksummed byte-identical each
time:

| mutation | result |
| --- | --- |
| apply **every** proposal, ignoring `accepted_proposal_ids` | **RED** |
| stop refusing ids that are not in this review | **RED** |
| drop the endpoint's `assertCan(…, 'meeting_proposal.apply', …)` | **RED** |

**I nearly reported the third as unguarded.** Run against
`test/services/meeting-reviews.test.ts` alone it comes back **green**, and I read
that as a hole. It is red against the full server suite — **the guard lives in the
route tests, and I ran a filtered suite.** That is CLAUDE.md §5's *"the gate is
the repo-root `pnpm test`, not your workspace's"* landing on the reviewer, and it
is the third instrument error of mine today. **The finding was mine, not yours,
and it was wrong.**

### §10.2 answered the question my task file left open

> *"The Notes wondered whether `decision` might have no board effect. §11.4.2 says
> it does: **'Accepted `decision` proposals from a meeting diff append to it with
> the date.'** … **The spec settled it, not a choice I made.**"*

**That is the rule arriving from the other direction** — my *"quote the artefact,
do not paraphrase from a description of it"* was written about a builder trusting
a task file. **Here the task file was mine and vaguer than the document it
described**, and you went to the document. Pinning the shape — heading once, one
list across meetings, `2026-01-15` and not a locale — is the part a later reader
needs.

### `can()` per proposal, and the case that proves it is not a table

> *"`meeting_proposal.apply` is member-and-up, but a `decision` writes
> `context_md`, which is lead-only — so **a member can apply one proposal in a
> review and not another**."*

**And the test proves the owner *can* do the one the member could not**, which is
what makes the refusal about the role rather than about the proposal being
unapplicable. **Without that second half the first is ambiguous** — a refusal
proves nothing until something proves the action was possible.

> *"The day §3.2's row changes, this changes with it and I do not have to
> remember."*

**That is the property worth having**, and it is why the per-proposal shape is
better than a table in this file even though a table would read more clearly.

### LAI-045's guard caught its own author

> *"My `meeting.applied` payload named `taskId`. The activity sweep went red with
> `meeting.applied: "taskId"` — **a Drizzle property leaking into an audit row,
> in the one payload a person reads when asking why a task moved.**"*

**The guard that caught this is the one you filed and built**, from a task I
renumbered out of a collision this morning. **A check catching its author is the
outcome to want**, because it is the only proof that it does not depend on the
author remembering.

### Seven break-probes

Apply-everything, stranger ids, writing `context_md` directly rather than through
the service, the missing `applied_at`, an audit payload reduced to a count, no
transaction, and trusting `status` over the clock. **The sixth and seventh are the
ones I would not have thought to ask for** — *"landing half of it would be a board
state nobody accepted, and the caller cannot tell which half from an error body."*
