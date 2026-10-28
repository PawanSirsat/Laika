---
id: LAI-571
title: 'PATCH /tasks/:id takes a precondition (If-Match or expected_updated_at), so a late write cannot overwrite a newer one'
area: server
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-538
status: review
started: 2026-10-28T11:49:29Z
finished: 2026-10-28T12:06:49Z
---

Filed by SHELL (Belka, dispatched by CHIEF) from the Codex round-5 review of
PR #106. **File only** — CORE's area; nothing here was implemented.

## Why

`updateTask` (`server/src/services/tasks.ts`, `const now = input.now ??
Date.now()`) stamps `updated_at` with the wall clock and applies a `PATCH`
unconditionally. Neither is a revision, so a client cannot order its writes
against the server's state:

- **Two writes in one millisecond share an `updated_at`.** LAI-538's drawer
  works around it with a client-side read order (`server/web/src/api/
  read-order.ts`), but that only tells reads apart, not writes.
- **An aborted request is not a cancelled write.** LAI-538 gives an agent
  selection a 30 s deadline, aborts the request, reads the task back and then
  lets the next selection go. If the server still executes the aborted `PATCH`
  *after* that read-back, it overwrites the later selection — and nothing on
  the client can prevent it. The read-back is not a write fence.

Only a server-enforced precondition makes the order a guarantee: the client
says which version it last saw, and the server refuses a write against any
other.

## Scope

- `PATCH /tasks/:id` accepts a precondition — `If-Match: <revision>` (and an
  `ETag` on every `TaskView` response), or a body field such as
  `expected_updated_at`. Which one, and whether `updated_at` stays the token or
  a monotonic `revision` column is added (two writes in one millisecond argue
  for the column), is CORE's design call.
- A mismatch answers `409` (`conflict`, §6.3) with the current task in
  `details`, so a client can show the truth without a second read.
- Absent precondition keeps today's behaviour, so every existing caller
  (web, MCP, CLI) is unaffected until it opts in.
- The MCP `update_task` tool may take the same precondition (decide with
  SHELL; the plugin and the SPA are SHELL's half).

## Acceptance criteria

- [x] A `PATCH` with a stale precondition is refused `409` and changes
      nothing (asserted on the row and the activity log).
- [x] A `PATCH` with a current precondition succeeds and returns the new
      precondition value.
- [x] Two writes in one millisecond with the same precondition: exactly one
      succeeds.
- [x] A `PATCH` with no precondition behaves exactly as today (existing
      route tests unchanged).
- [ ] SPEC §6.4 names the precondition (CHIEF's half, §4.4 if it is a new
      field the client mirrors).
- [ ] Repo-root gate exits 0.

## Follow-on (SHELL, not this task)

`server/web` sends the precondition on agent selection (`selectTaskAgent`), so
a write aborted at the deadline can no longer land after a newer one.

Claimed by Strelka (D-097) on a branch cut from `origin/LAI-542-agent-session-helper` @ `01618534`, per the [belka] hand-off on LAIKA-823. The file was copied in from `origin/LAI-538-drawer-agent-field` (not in the base); that branch and `integration-agent-identities` keep a `backlog/` copy, which is the two-copy shape (§2). Whoever merges deletes it.

## Implementation notes (Strelka, LAI-571)

**Design.** The precondition is `If-Match: "<updated_at>"` and the token is the
task's existing `updated_at`, sent as a strong `ETag` on `GET /tasks/:id` and on
every successful `PATCH /tasks/:id`; a guarded write is one compare-and-swap —
`UPDATE tasks SET updated_at = max(now, expected + 1) WHERE id = ? AND
updated_at = expected` — inside `updateTask`'s existing `immediate`
transaction, before tags, fields, the selection, the estimate or any activity
row can move, and zero rows changed is `409 conflict` with `details: { current:
TaskView }`.

**Why not a `revision` column.** Every other writer of a task (claim, status,
position, branch, the GitHub webhook) already advances `updated_at`, so it is
already the version every write moves; a column would need bumping at each of
those sites or by a trigger, plus a migration, a SPEC §4 row and a `TaskView`
field the client mirrors — a three-owner change. `max(now, expected + 1)` makes
two guarded writes in one millisecond take distinct stamps, which is the one
case `updated_at` alone could not tell apart. Header-only, so no new
`TaskView` field and no `view-type-drift` line: nothing for SHELL in this half.

**Known limit, recorded rather than fixed.** An *unguarded* write that lands
in the same millisecond as the stamp a client holds (a claim, a status move, a
PATCH without `If-Match`) stamps `now`, which can equal that token, so the
client's guarded write would still pass. That needs every task writer to stamp
monotonically and is outside this task: filed as LAI-317.

**What changed.**
- `server/src/http/routes/tasks.ts` — `taskEtag`, `parseIfMatch` (only `"N"`,
  a non-negative safe integer without leading zeros; anything else, `*` and
  weak `W/` included, is `400 bad_request` with `details: { header: 'If-Match'
  }`); `ETag` on `GET /:id` and `PATCH /:id`.
- `server/src/services/tasks.ts` — `UpdateTaskInput.expected_updated_at`; the
  CAS; the guarded stamp used by both later `updated_at` writes. No precondition:
  `updatedAt = now`, byte-for-byte today's path. MCP `update_task` never sets
  the field, so its behaviour and the tool surface are unchanged.
- `server/test/http/routes/tasks.test.ts` — five tests: stale → 409 `conflict`
  with the current task, row, activity and tags unchanged; malformed `If-Match`
  → 400; current → 200 with the new `ETag` equal to the body's `updated_at`;
  two writes in one frozen millisecond with one `If-Match` → exactly `[200,
  409]`, one activity row; no `If-Match` in a frozen millisecond → today's
  stamp.

**Mutation check** (`npx vitest run test/http/routes/tasks.test.ts -t
"If-Match|same-millisecond"`, file restored and checksum-compared after each):
dropping `eq(tasks.updatedAt, expected)` from the CAS → the stale and the
same-millisecond tests red; stamping `now` instead of `max(now, expected + 1)`
→ the same-millisecond test red. Both mutations' anchors matched exactly once.

**Gate.** `TEST 1`, `LINT 0`, `FMT 0`. The only failures are the five
inherited `server/web` ones at base `01618534` (the missing client halves of
LAI-534/535/541): *activity wording covers the server's vocabulary*; *every
served endpoint has a caller, or a named reason*; *the stream subscribes to
exactly what the server emits*; *every server field is visible to the client*;
*describeProjectEvent*. `server/web`'s output with this branch's two source
files and with base's, sorted and with temp paths stripped, is identical — no
new line in any of the five. "Repo-root gate exits 0" stays unticked for that
reason.

## Notes for Belka (SPEC half)

Proposed for SPEC §6.4, a new paragraph after the `PATCH /tasks/:id` body
paragraph (the one ending *"…and pages with `cursor` like any other filter
(D-066)."*):

> **A `PATCH` may be conditional** (LAI-571). `GET /tasks/:id` and every
> successful `PATCH /tasks/:id` carry `ETag: "<updated_at>"` — the task's
> `updated_at` (§4.5) as a quoted integer. A `PATCH` that sends `If-Match` with
> that value is applied only if the task's `updated_at` still equals it, checked
> and written in one transaction; otherwise it is `409 conflict` with `details:
> { current }`, the task as `GET /tasks/:id` would return it, and nothing is
> written — not a field, a tag, a selection or an activity row. A guarded write
> stamps `updated_at` with the later of now and the old value plus one, so two
> guarded writes in one millisecond never share a version. `If-Match` other
> than one quoted non-negative integer — `*` and weak `W/` tags included — is
> `400 bad_request` with `details: { header: 'If-Match' }`. Without `If-Match`
> a `PATCH` is unconditional, as before. MCP's `update_task` takes no
> precondition.

No `TaskView` field was added, so §4.5 and the client types need nothing.
