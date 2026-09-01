---
id: LAI-448
title: 'A system principal, so cron and webhooks satisfy §3.3 rule 1'
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-446
status: done
started: 2026-09-01T20:05:00Z
finished: 2026-09-01T20:45:00Z
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

- [x] `can()` recognises the system principal **explicitly**, by a distinct kind
      — not by a sentinel `userId`, not by `orgRole`. A principal that is a user
      with a special id is one refactor from being granted a user's authority.
- [x] It holds **exactly** the actions §10.1 and §11.6 need, enumerated: the
      task-status change and comment create the webhook performs, and whatever
      `jobs.ts`'s eight writes require. **Every other action is denied, and a
      test says so cell by cell**, the way every §3 row already is.
- [x] **Project-scoped.** The webhook's grant is on the project the delivery
      resolved to; a delivery that resolves to no project performs no write.
      Deny-by-default (rule 3) must still fall out rather than be re-implemented.
- [x] **`jobs.ts`'s eight writes go through it**, and each calls `assertCan`.
      This is the first caller precisely because it already exists — **the
      mechanism is proved against a real violation rather than against new
      code.**
- [x] A test that a system principal **cannot** do the things a human can:
      delete a project, change a role, mint a token. **Both directions** — the
      granted set and a sample of the denied one — because a principal that
      passes everything and a principal that passes the right things look
      identical from the granted side.
- [x] **Attribution is unchanged**: `actor_kind: 'system'`, `actor_id: null`
      (§4.8). Authority and attribution are different questions and this task
      decides only the first — say so at the site.
- [x] `policy-spec-drift` covers §3.4's actions the way it covers §3.1 and §3.2.
      A section describing a grant with nothing comparing it to the code is the
      gap `CONVENTIONS.md` §5.1 calls the axis with no guard.
- [x] Full gate green — **`EXIT 0`**.

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

## Outcome

`SystemPrincipal` in `policy/can.ts`: a distinct kind with a literal
discriminant, `can(principal: Principal, …)`, and a `SYSTEM_GRANT` set that is
§3.4 in full.

### The grant, and why two of the six are not new actions

**Four `system.*` actions with no human owner** — `heartbeat.prune`,
`task.flag_stale`, `invite.expire`, `meeting_review.expire`. Nobody expires an
invite through the API, and a person who could would be doing something the
product does not offer.

**`task.write` and `comment.create` for §10.1, unchanged.** The webhook moves a
task and writes a comment; those are the *same* operations a person performs on
the same resources, and giving them system-only twins would mean two rules for
one operation and, eventually, two answers.

**Deny-by-default does the work rather than a special case.** §3.1 and §3.2 have
no row for the four, so `canOrgAction`/`canProjectAction` never see them — an
Owner asking for `system.invite.expire` is refused by rule 3, not by a rule I
added. The one explicit line is in the *user* branch, and it is there so the
reason is readable rather than implied by omission.

### The cron was the right first caller, and the interesting half was the guard

**Eight writes, zero `assertCan`** — and the finding is not that I added the
calls. It is that **removing one was invisible**:

```
MUTATION: expireInvites no longer asks
EXIT=0   (0 failures across test/jobs and test/policy)
```

`assertCan(SYSTEM, …)` always passes here, because the principal holds the
action, so deleting it changes nothing behaviour can see. **That is how the rule
came to be broken in eight places without anybody noticing**, and a task that
only added the calls would have left the next removal just as silent.

So the property is asserted structurally, comments stripped first — both files
discuss `assertCan` at length, and a check that reads prose as code reports its
own documentation (LAI-159, learned the hard way).

**`vacuum` keeps no `assertCan`**, and says why at the site: §3.3 rule 1 governs
reading and writing *data*, `VACUUM` rewrites the storage file and touches no
row, and there is no resource to name. Inventing `system.database.vacuum` to
satisfy the shape of the rule would add a permission that grants nothing and has
to be maintained for ever. It is exempted **by name** in the guard, so a fifth
job cannot inherit the exemption by accident.

**No cron write needed an action no human role holds in a way that widened
anything** — the four are new names for operations that were never anybody's,
which is the answer your Notes asked me to report either way.

### Both directions, and the denied side is the one that matters

`holds nothing else in the closed union` sweeps **`ALL_ACTIONS`** rather than a
list, so `org.delete`, `user.set_role` and `token.create_own` are covered by
construction. The three D-050 names are *also* asserted individually — redundant
on purpose, so the failure message says what leaked instead of printing a list.

And the other direction: every one of the four is denied to Owner, Admin, Member
and Viewer.

### The exemption expires itself, which it would not have

Four entries in `ACTIONS_WITHOUT_A_ROW` — §4.4's in-flight mechanism, in my file,
named for §3.4 and the merge that retires them.

**But the existing staleness test reads §3.1 and §3.2 only.** §3.4 is a *new
section*, so it would never have fired, and the exemptions would have become
permanent silently — the exact shape LAI-415 and LAI-444 are both about.

So `policy-spec-drift` now scans §3.4 for the action names whenever it exists,
and feeds them into `granted`. Scanned rather than parsed as a table because the
row labels are yours to choose and guessing them would fail for the wrong reason.
A §3.4 that exists but names none of them **throws** rather than quietly leaving
the exemptions in place.

Verified by simulation rather than by reading it: pasting a §3.4 into the SPEC
turns `removes an exemption once §3 grants the action` red immediately, and
reverting restores green.

### Attribution is untouched

`SystemPrincipal` carries no `actor_kind` and no `actor_id` — deliberately, and
said at the type. §4.8 answers what the row says; this answers what the trigger
may do. Conflating them is how a principal acquires an identity by accident.

### Verification

| mutation | result |
| --- | --- |
| a job stops calling `assertCan` | red — **invisible before this task** |
| the principal holds everything | red — 2 tests |
| drop the project scoping | red |
| let an Owner hold a `system.*` action | red — 2 tests, including a token-scope sweep |
| a job asks for `task.write` instead | red — 3 tests |

The fourth is worth noting: it also broke `denies every write action to a
read_only token, exhaustively`, which is an existing test noticing that the
action set had changed underneath it. I re-ran the fifth after a lint rewrite of
the assertion rather than assuming a regex-to-`includes` change left it catching.

### For LAI-446, found here rather than there

**Services take `ResolvedActor`, not `Actor`.** `changeStatus` and `addComment`
both do, and a `SystemPrincipal` is neither — so LAI-446 cannot simply hand this
principal to a service. Widening those signatures is a real change and is not in
this task's criteria, so it is flagged rather than done: whoever takes LAI-446
meets it in the first ten minutes otherwise.

### Gate

Root `pnpm test` **EXIT=0**, zero unhandled errors. `server` **1799/1799**,
`web` 604/604, `cli` 49/49, `pnpm lint` EXIT=0, `pnpm format` EXIT=0.

---

## Accepted — CHIEF, 2026-09-02

**Accepted**, with §3.4 applied. Root gate `EXIT 0` — **1799** server, 604 web,
49 cli.

### The finding is not the missing calls

> *"**It was that removing one is invisible.** `assertCan(SYSTEM, …)` always
> passes — the principal holds the action — so deleting it changes nothing
> behaviour can see."*

**Measured independently:** deleting `assertCan(SYSTEM, 'system.invite.expire')`
fails **two** tests — your structural `calls assertCan in every job that touches
a row`, and the exemption staleness — and **all 406 behavioural tests pass with
the call gone.**

**That is how the rule came to be broken in eight places without either of us
noticing**, and a task that only added the calls would have left the next removal
just as silent.

### The exemption that would never have expired

> *"Its staleness test reads §3.1 and §3.2 only, and **§3.4 is a new section** —
> so it would never have fired, and the four would have become permanent without
> anybody deciding that."*

**A self-expiring exemption whose expiry condition cannot be observed is just an
exemption**, and it looks exactly like the ones that work. Scanning §3.4 for the
names rather than parsing it as a table — *because the row labels are CHIEF's and
a guess would fail for the wrong reason* — and **throwing when §3.4 exists and
names none of them**, rather than quietly leaving them.

**Verified by simulation before there was a §3.4 to verify against**, which is
the second time today you have tested an expiry against a document that did not
exist yet.

### Three grants I would have got wrong

**`task.write` and `comment.create` as the human actions, not system twins** —
*"the same operation on the same resource; only the principal differs. Twins
would be two rules for one operation and eventually two answers."*

**Deny-by-default doing the work** — §3.1 and §3.2 have no row for the four, so
the role branches never see them — **with the one explicit deny in the *user*
branch so the reason reads rather than being implied by omission.**

**`VACUUM` holding no action, exempted by name.** *"Rule 1 governs reading and
writing **data**; `VACUUM` rewrites storage and touches no row, so there is no
resource to name. A `system.database.vacuum` would be a permission that grants
nothing."* **By name, so a fifth job cannot inherit it** — the difference between
an exemption and a hole.

**And a distinct `kind` rather than a sentinel `userId`**, for the reason the
criterion gave and the docblock repeats: *a row that means "the system" is one
refactor from being handed a real user's authority.*

### Stripping comments, knowing in advance

Third guard this week to need it — after `use-events.test.ts` and LAI-159's — and
**the first where somebody knew before the first run**: *"both files discuss
`assertCan` at length and I have already been bitten by a check reading its own
documentation."*

### And the LAI-446 half

You said so before I merged, which is §4.4 working. I could not strip it —
`3277b35` is an ancestor of everything here. **Reviewed on its merits and it
stands; not an accepted task**, and that is written on LAI-446 so `master` does
not carry half a task with no record of why.

**The `ResolvedActor` finding is a criterion there now.** Services take
`ResolvedActor`, not `Actor`, so a `SystemPrincipal` cannot simply be handed to
one — **found while building this and flagged rather than left to be met in the
first ten minutes of the next task.**
