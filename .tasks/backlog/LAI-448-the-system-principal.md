---
id: LAI-448
title: 'A system principal, so cron and webhooks satisfy §3.3 rule 1'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-446
status: backlog
---

## Goal

**§3.3 rule 1 is being broken today**, and the fix is one mechanism with two
callers. **D-050 decides the shape**; read it first.

> *"**Every** route and **every** MCP tool calls `assertCan` before reading or
> writing — REST, MCP, **webhook-triggered, cron-triggered**, admin. No
> exceptions, no 'internal' path."*

**The §11.6 cron calls `can()` zero times** across eight writes in
`src/jobs/jobs.ts`. **And LAI-446's webhook handlers cannot call it** without an
actor to call it about.

## The shape

**A named system principal that `can()` recognises explicitly**, holding
**exactly** the actions a system trigger needs and **nothing else**, scoped to
the project a delivery resolved to.

**Not a fifth column in §3.1.** That matrix is org roles; a column there puts the
system principal on the same axis as a person. **§3.4 is its own section** —
written and held by CHIEF, applied at merge — and it gets its own rows in
`matrix.test.ts`, so **the grant is readable in the executable version of §3
rather than implied by an object literal.**

## Acceptance criteria

- [ ] `can()` recognises the system principal **explicitly**, by a distinct kind
      — not by a sentinel `userId`, not by `orgRole`. A principal that is a user
      with a special id is one refactor from being granted a user's authority.
- [ ] It holds **exactly** the actions §10.1 and §11.6 need, enumerated: the
      task-status change and comment create the webhook performs, and whatever
      `jobs.ts`'s eight writes require. **Every other action is denied, and a
      test says so cell by cell**, the way every §3 row already is.
- [ ] **Project-scoped.** The webhook's grant is on the project the delivery
      resolved to; a delivery that resolves to no project performs no write.
      Deny-by-default (rule 3) must still fall out rather than be re-implemented.
- [ ] **`jobs.ts`'s eight writes go through it**, and each calls `assertCan`.
      This is the first caller precisely because it already exists — **the
      mechanism is proved against a real violation rather than against new
      code.**
- [ ] A test that a system principal **cannot** do the things a human can:
      delete a project, change a role, mint a token. **Both directions** — the
      granted set and a sample of the denied one — because a principal that
      passes everything and a principal that passes the right things look
      identical from the granted side.
- [ ] **Attribution is unchanged**: `actor_kind: 'system'`, `actor_id: null`
      (§4.8). Authority and attribution are different questions and this task
      decides only the first — say so at the site.
- [ ] `policy-spec-drift` covers §3.4's actions the way it covers §3.1 and §3.2.
      A section describing a grant with nothing comparing it to the code is the
      gap `CONVENTIONS.md` §5.1 calls the axis with no guard.
- [ ] Full gate green — **`EXIT 0`**.

## Notes / context

**Do not add a third `can()` exception.** CLAUDE.md §5's two are exhaustive as
written and both rest on *nothing is read or written*. **A webhook writes.** The
principal makes the grant reviewable where an exception hides it.

**Do not give it an org role.** `orgRole: 'owner'` would work and is the thing
D-050 refuses: a webhook secret leak becomes an org takeover rather than a
nuisance.

**LAI-446 depends on this**, and its AC5 — *"decide what actor a webhook acts
as"* — is answered here rather than there.

**The eight cron writes are the interesting half.** If any of them turns out to
need an action no human role holds, that is a finding worth reporting rather than
a reason to widen the principal quietly.
