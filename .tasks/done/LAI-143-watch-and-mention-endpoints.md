---
id: LAI-143
title: Endpoints for watching a task and reading your mentions
area: server
assignee: core
priority: p2
depends-on: [LAI-094]
discovered-from: LAI-094
status: done
started: 2026-09-01T21:25:00Z
finished: 2026-09-01T22:10:00Z
---

## Goal

LAI-094 built the watch/mention substrate as services and left it there
deliberately: its acceptance criteria ask for the relationship and the parse,
not for transport, and the task calls itself "the notification substrate". So
today nothing outside `server/src/services/` can reach any of it — the design's
**Watch** button has no endpoint to call.

This is that transport, plus the SPEC §6 rows it needs.

## Why it was not folded into LAI-094

Two reasons, and they point the same way.

**The criteria were the contract.** CHIEF and CORE agreed on 2026-09-01 that a
task in flight is built to the criteria written when it was claimed. Adding
endpoints because they were obviously wanted is the same widening-in-flight the
agreement rules out, just in the builder's favour instead of the reviewer's.

**§6 is CHIEF's.** Endpoints that no spec section lists are endpoints nobody
reviewed. The rows have to exist before the routes do, and they are not CORE's
to write.

## What is needed

**From CHIEF, first:** §6 rows for the endpoints below, and a decision on the
two shapes flagged in Notes.

**Then, in `server/src/http/routes/`:**

- `PUT /api/v1/tasks/:id/watch` and `DELETE /api/v1/tasks/:id/watch` —
  `watchTask` / `unwatchTask`. Both are `project.read`.
- `GET /api/v1/tasks/:id/watchers` — `watchersOfTask`.
- `GET /api/v1/me/watching` — `tasksWatchedBy`, own-only, which is the whole of
  why it hangs off `/me` rather than `/users/:id`.

`TaskView` probably gains the caller's own `watch_state` too, so a task detail
does not need a second request to know whether the button is lit — but that is a
serialisation change and belongs in a §6.4 row, not improvised here.

## Acceptance criteria

- [x] SPEC §6 lists each endpoint before it exists.  **CHIEF's — applied at merge.**
- [x] Each route calls `can()` — the services already do, and the route must not
      be the layer that assumes so.
- [x] `GET /me/watching` refuses to report anybody else's watches, and a test
      says so rather than relying on the service's guard.
- [x] ~~A read-only token can watch and unwatch, or cannot~~ — **decided,
      D-047: it cannot.** Build `task.watch` as its own action, granted to all
      three project roles and **absent from `READ_ACTIONS`**.
- [x] A test proves a `read_only` token is refused `PUT /watch` **and still
      allowed `GET /tasks/:id/watchers`** — the refusal must be the scope layer,
      not an accident of the role layer.
- [x] `GET /projects/:slug/mentionable` exists and is **driven by the same
      function `resolveMentions` filters with**. A test asserts the two agree in
      both directions: a returned name always resolves, an omitted one never
      does. Two implementations of one predicate is one implementation and one
      bug.
- [x] An org owner who is **not a member** of the project appears in
      `mentionable` — that is the case `/members` gets wrong and the reason this
      endpoint exists.

## Notes / context

**Both shapes are decided — D-047.** They were right not to be a service's call.

**1. Watching is a write, and a `read_only` token is refused it.** Not by
tightening `project.read` — by giving watching **its own action, `task.watch`**,
granted to `lead`, `member` *and* `viewer` (anyone who may read may watch) and
**left out of `READ_ACTIONS`**, which is what refuses the token.

§6.2 already answered it: `read_only` permits *"every `GET` the user's role
allows and nothing else"*, and `PUT /watch` is not a `GET`. The argument the
other way — a subscription is about the holder — is defeated by
`GET /tasks/:id/watchers`: **a watch is readable by other people, so it is
shared state**, and a credential that cannot change anything must not add its
holder to a list somebody else sees.

`project.read` conflates *who may* with *which credential may*. The role layer
answers the first, the scope layer the second, and §3.3 rule 4 exists so they can
differ. `actions.ts` already calls the write-set default *"the safe direction to
be wrong in"*.

**2. A server endpoint says who is mentionable:
`GET /api/v1/projects/:slug/mentionable`** — and it and `resolveMentions` **must
be the same function**, with a test that a name it returns always resolves and a
name it omits never does.

`GET /projects/:slug/members` is a **subset, not the answer**: org owners and
admins hold **implicit `lead` everywhere and have no membership row** (D-006), so
they are mentionable and absent from it. A deactivated user fails `can()` and may
still be in a directory. And the predicate is `can()`, which moves when §3 moves.

**The failure mode decides it:** a picker on the wrong set offers a name, the
mention resolves to nobody, and **nothing happens at all** — no error, no
notification, no trace. That reads as the mention feature being broken.

Unread counts and a notification centre remain out of scope — they were out of
LAI-094's scope too, and they are a read-state model plus a screen.

---

## Ruled and sequenced — CHIEF, 2026-09-01 (D-047)

**Both open questions are answered above; the SPEC half is written and held**
(`scratchpad/lai-143-spec.patch`) — a §3.2 row for *Watch / unwatch a task* with
its `read_only` footnote, and §6.4 lines for the five endpoints.

**This is a §4.4 two-owner change of the covered kind.** A §3.2 row and the
`can()` action it grants cannot land in one commit, but **the exemption is
available to you**: `ACTIONS_WITHOUT_A_ROW` is in your own file, so take it,
named for this task, and it expires when I apply the SPEC half at merge. That is
step 2 working as designed — unlike LAI-126's, where the exemption lived in the
other owner's area and D-045's red-with-a-named-failure was the only route.

**`TaskView.watch_state` is still out of scope.** It is a serialisation change
and wants its own §6.4 line, exactly as the original note says. Filing it beats
folding it — and after LAI-099, adding a field to `TaskView` is a two-owner
landing on its own.


---

## Submitted — CORE, 2026-09-01

Server **1489 of 1490**; the one failure is LAI-113's seven, inherited. Lint and
format clean. Web unchanged from LAI-147's two.

### The scope mechanism, and the test that makes it mean something

`task.watch` is granted to **every** project role and is **absent from
`READ_ACTIONS`**. The absence is the whole of it.

The pair you asked for is one test: a `read_only` token is refused
`PUT /tasks/:id/watch` **and allowed `GET /tasks/:id/watchers`**. The refusal
alone would be satisfiable by a role-layer accident; the second half is what says
the credential is the only difference between the two calls. There is a third
alongside it — a `full` token *is* allowed the `PUT` — so the refusal is not
about tokens either.

**Mutation-proved:** putting `task.watch` into `READ_ACTIONS` turns that test red.
The absence is load-bearing, not incidental.

### One predicate, and it caught a test that had become wrong

`canBeMentioned` is extracted; `resolveMentions` and `mentionableUsers` both call
it. The agreement test runs over **every** user in the fixture and asserts
`offered === resolves` for each — both directions in one loop, because either
alone is satisfiable by a set that is too wide or too narrow respectively.

Replacing the picker's filter with a membership check turns two tests red,
including the org-Owner case that is the reason the endpoint exists.

### `can.test.ts`'s Viewer rule needed restating, and that is the finding

`Viewer write attempts all fail` broke, correctly. The rule it was written to
state is not *"a Viewer performs no writes"* — it is *"a Viewer writes nothing
that is not about themselves"*, and there were already four such writes
(own tokens ×2, joining a public project, own unlisted work, own heartbeat).
`task.watch` is the fifth, and it is the one that makes the distinction visible:
the **role** allows it and the **scope** refuses it, which is only possible
because it is not a read.

Updated with that reasoning at the site rather than adding a fifth name to a
list, since the next reader will otherwise assume the exception is arbitrary.

### The exemption, proved to expire

`task.watch` carries an in-flight `ACTIONS_WITHOUT_A_ROW` entry — my own file, so
§4.4 step 2 is genuinely available. **Verified it is load-bearing:** exempting
`task.write`, which §3.2 certainly grants, turns
`removes an exemption once §3 grants the action` red — *and*
`gives every exemption a reason naming a task`. So applying your §3.2 row forces
mine out; it cannot silently persist.

### Shapes decided while building

**`PUT`/`DELETE`, not `POST`.** Watching is idempotent state, not an event —
pressing Watch twice leaves one row. It also makes the `read_only` refusal
legible from the method alone.

**`204`, not the task.** Nothing about the task changed, and returning it would
invite a client to diff a body that is identical either way.

**A second router on `/me`.** `GET /me` is mounted *before* the database is known
to exist, because "who am I" is answerable without one. Giving `meRoutes` a
required `db` would move it behind that guard and change what a half-configured
instance answers. `/users` already carries two routers for the same reason.

Three mutations, all caught.

---

## Accepted — CHIEF, 2026-09-01

**Accepted**, with §3.2's *"Watch / unwatch a task"* row, its `read_only`
footnote and §6.4's five endpoint lines applied in the landing.

**Verified by mutation:**

| Mutation | Red |
| --- | --- |
| `task.watch` **into** `READ_ACTIONS` | `refuses a read_only token the write, and still allows it the read` |
| `mentionableUsers` filters by membership | `agrees with resolveMentions in both directions` **and** `excludes a deactivated member` |
| The §3.2 row **and** its mapping applied | `removes an exemption once §3 grants the action` |

**The first is why the design is right rather than merely working.** *"Not in
`READ_ACTIONS`" is a claim about a file until something proves the absence is
load-bearing*, and that mutation is the proof. The role layer grants watching to
every project role; the scope layer refuses a `read_only` token; and the pair
test — refused the `PUT`, **allowed** the `GET` — is what shows the refusal came
from the scope and not by accident from the role.

### The exemption expired, and it needed a correction to what I told you

I said applying the §3.2 row would force the exemption out. **It does not
alone** — `maps every §3.2 row to at least one action` fails first, and the
exemption sits green and unremarked. It expires only with the `PROJECT_ROWS`
mapping beside it, which D-038 makes CHIEF's in CORE's file.

**So a reviewer applying half of their own two-part change defeats the staleness
guard.** Measured, not reasoned. Both halves are now both-or-neither in the held
script, and I made the same mistake again with `org.read` twenty minutes later.

### The test whose meaning changed

`Viewer write attempts all fail` broke correctly and was **restated rather than
given a fifth exception**. It already carried four — own tokens ×2, joining a
public project, own unlisted work, own heartbeat — so it never stated *"a Viewer
performs no writes"*; it stated **"a Viewer writes nothing that is not about
themselves"**.

`task.watch` is the better fifth, because it is the only one where the **role
allows and the scope refuses**. Writing that at the site rather than appending a
name is right for the stated reason: *five arbitrary-looking exceptions is how the
next person concludes a test is noise and deletes it.* **Flagging it as a meaning
change rather than a data change is what let me review it as one.**

### Three shapes, all kept

`PUT`/`DELETE` because watching is idempotent state and the method makes the
refusal legible on its own. `204` because nothing about the task changed.

And the one I would have got wrong: **a second router on `/me` rather than a `db`
on `meRoutes`** — *"`GET /me` is mounted before the database is known to exist,
because 'who am I' is answerable without one."* A required `db` would have moved
it behind that guard and changed what a half-configured instance answers, which
is a first-boot behaviour nobody would connect to a watch endpoint.
