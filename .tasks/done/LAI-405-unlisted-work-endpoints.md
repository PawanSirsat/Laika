---
id: LAI-405
title: Unlisted work — read, promote, dismiss
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: done
started: 2026-08-31T12:35:00Z
finished: 2026-08-31T13:05:00Z
---

## Goal

`log_unlisted_work` is the one MCP tool with no REST twin (D-024, SPEC §7.2):
an agent noticing something outside any project has nowhere else to put it. The
humans' side of that — reading the pile and acting on it — **is** REST, and none
of it exists.

The `unlisted_work` table is already in the schema with its indexes.

```
GET    /api/v1/unlisted                  ?user=&since=
POST   /api/v1/unlisted/:id/promote      { project_slug, title, priority? } -> task
DELETE /api/v1/unlisted/:id              dismiss
```

## Acceptance criteria

- [x] All three routes exist, thin over `server/src/services/unlisted.ts`.
- [x] **Every endpoint calls `can()`.** Reading the pile is org-level and follows
      the audit-log cell (SPEC §3.1: `unlisted.logged` is named there as a
      `project_id IS NULL` audit row) — so `audit_log.export`. Promoting creates
      a task in a named project and must therefore also pass `task.write` **in
      that project**. Two checks, not one.
- [x] `?user=` and `?since=` filter; the list is paginated per §6.3 conventions
      and sorted newest first.
- [x] Promote creates a real task through the **existing tasks service**, not a
      second insert path, sets `promoted_task_id` on the row, and returns the
      created task. A row already promoted is `409`, not a second task.
- [x] Dismiss sets `dismissed_at` and is idempotent. Dismissed rows are excluded
      from the default list and reachable with an explicit filter.
- [x] Promote and dismiss each write exactly one `activity` row. The promoted
      task's own creation row is written by the tasks service as it already is —
      do not write it twice.
- [x] Tests: filters, pagination, promote happy path, double promote is `409`,
      dismiss idempotent, a Member is `403` on the list.
- [x] Full gate green.

## Notes

No new dependencies.

**Writing an unlisted row is not in this task** — that is `log_unlisted_work` in
LAI-408. Build the read/act side against rows you insert in the test fixture.

## Notes back — CORE, 2026-08-31

**The two-check property needed a token to isolate, and my first test did not.**

By role alone the two `can()` calls cannot be separated: `audit_log.export` is
Owner and Admin, and `can.ts` line 95 gives both **implicit lead on every
project** — so anyone passing the first passes the second, and a role-based test
passes whether or not the second check exists. I wrote that test first.

A **token narrowed to another project** separates them, and is a real case since
LAI-402: `audit_log.export` carries no `projectId` so the whitelist does not
apply, while `task.write` carries one and is refused. Reading the pile succeeds
and promoting into the out-of-scope project does not.

**Two things §4.14 asks for that the criteria did not repeat**, both implemented:
`created_via: 'mcp'` preserved on the promoted task, and the agent's note kept as
the task body — it is the only record of *why* the work was worth noticing.

**No new activity verb.** §4.8 is closed and growing it is a SPEC change. Both
actions ride under `unlisted.logged` with `{ entity, action, … }`. That makes
**three** features now filing under a verb that does not name them — sprints,
the context document, and this — which is worth adding to LAI-113.

**`db/orgs.ts` is new and slightly beyond scope.** `unlisted.ts` would have been
the third private copy of `currentOrgId`. I added the shared one and used it, and
filed **LAI-140** to converge the two that remain rather than editing two
unrelated services here. They currently disagree about the no-org case in a way
that matters — one throws `ApiError('not_found')`, one a plain `Error`, which is
a 404 versus a 500.

---

## Accepted — CHIEF, 2026-08-31

**Accepted.** Two mutations, both red on exactly the right tests.

| mutation | result |
| --- | --- |
| strip the token narrowing before `createTask` | red: *"needs `task.write` in the named project, not just audit access"* |
| remove the already-promoted guard | red: *"refuses a second promote with 409 and creates no second task"* + the HTTP twin |

**The second check is inside `createTask`, and that is better than what the
criterion asked for.** I wrote "two checks, not one" expecting both in
`unlisted.ts`; putting the second in the layer that owns it means promote cannot
drift from the ordinary create path, which is what LAI-409's parity will rest on.
One write path, one place `task.write` is enforced.

### The permission-test finding is the best thing here

*"By role alone they cannot be separated: `audit_log.export` is Owner and Admin,
and `can.ts` gives both implicit lead on every project — so anyone passing the
first check passes the second, and a role-based test passes whether or not the
second exists."*

Writing that test, looking at it, and **recognising it was worthless** is the
part worth recording. The fix — a token narrowed to another project, which only
became possible in LAI-402 — is the actor for whom the two permissions genuinely
differ.

**A permission test needs an actor for whom the two permissions actually
differ.** That generalises past this task, and it is the same lesson as LAI-081's
Viewer in a new place.

### §4.14's two unasked-for details were right to implement

`created_via: 'mcp'` preserved, and the agent's note kept as the task body.
*"The note is the only record of why the work was worth noticing; a triager's
title without it loses exactly what the pile existed to keep."* The criteria did
not name either; §4.14 did, and reading the spec section a task cites rather than
only its criteria is what the protocol asks for.

### `db/orgs.ts` — accepted as the minimal correct move

`unlisted.ts` would have been the third private `currentOrgId`. Adding the shared
one and **filing LAI-140 rather than editing two unrelated services** is the right
line: it stops the triplication without turning a feature task into a refactor.
That the existing two **disagree about the no-org case** — one `ApiError('not_found')`,
one a plain `Error`, a 404 versus a 500 — is a real finding and belongs in its own
task.

### The harness failure is now CLAUDE.md §5

*"A harness that cannot distinguish 'did not fail' from 'did not run' is not
evidence."* Reported unprompted, after catching it only because a traceback
happened to print above the ticks. **Six confident ticks, one meaningless.**

It is the worst place for this defect to live, because a mutation run is the
thing you trust *when the tests pass*. And it is not one session's problem — **two
of my own review mutations did the same thing today**, and I caught them by
reading output rather than by design. §5 now says: confirm the edit landed before
believing a red or a green.

I ran this review's first mutation, saw `!! MUTATION DID NOT LAND`, and did not
report a meaningless result. That check existed because of this report.
