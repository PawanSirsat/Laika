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

> **Superseded (Belka, 2026-10-29).** The design below, with `updated_at` as
> the token, a compare-and-swap, and the guarded stamp `max(now, expected + 1)`,
> was replaced after two Codex reviews. See *Review rounds* below for what
> shipped. The rest of this section is kept as the record of what was built
> first.

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

**Gate after merging `origin/master` (2026-10-29, Strelka).** The five
inherited failures above are gone: master carries the client halves. Two gates
on the merged head gave `TEST 1`, `LINT 0`, `FMT 0`, each failing on a
different test that this branch's diff does not touch:
*390px, dark: the user menu is off-canvas until the navigation opens*
(`server/web/test/browser/harness-theme.test.ts`, from master; it fails
1 run in 5 with that file run alone, `x=-81` mid-transition), and
*answers identically for a real account and an unknown one*
(`server/test/http/sign-in-throttle.test.ts`, a 5000 ms timeout during a
289 s run shared with another gate; green alone). A third failure, the LAI-581
two-copy collision master brought in, master has since fixed in #131.
"Repo-root gate exits 0" stays unticked until a gate with no flakes.

## Review rounds (Belka, 2026-10-29, taken over from Strelka)

**Round 1 (Codex, FAIL).** A tags-only `PATCH` left `updated_at`, and so the
token, unchanged: tags live in `task_tags`. The first fix stamped
`max(now, updated_at + 1)` at every writer it could find.

**Round 2 (Codex, FAIL).** The writer-by-writer fix missed these:
- tag rename, merge and delete (cascade)
- sprint delete (`ON DELETE SET NULL`)
- the blocker's side of a dependency (`blocks`)
- a blocker's status moving a dependent's `ready`
- comments (`comment_count`)
- estimate recomputes and rollups (`size`)
- the stale-flag job
- both backfills

Each of these changes what a read shows without moving the stamp.

**What shipped: the version is a digest of the view.** `taskVersion(view)` is
the first 128 bits of SHA-256 over `JSON.stringify` of the `TaskView`, and
`ETag: "<that>"` is sent on `GET /tasks/:id` and on every successful `PATCH`.

- **The check.** A `PATCH` with `If-Match` recomputes the view inside
  `updateTask`'s `immediate` transaction, which holds every other writer off.
  It runs after the claim fence (LAI-541, D-119) and before anything is written.
  A mismatch is `409 conflict` with `details: { current, etag }`.
- **Why a digest.** It is derived from the state a read returns, not stamped by
  writers. Every change a read can see changes it, including derived fields
  (`ready`, `blocks`, `comment_count`, `size`, tag names), whichever code path
  made the change. A writer added later cannot be missed.
- **Why it is deterministic.** `toView` has a fixed key order and sorted lists,
  and reads nothing about the caller or the clock. A task read has no
  self-changing fields.
- **Why not a `version` column with triggers.** That needs a trigger per
  referencing table, plus hand-written rules for each derived field (a
  dependent's `ready`, a parent's rollup), and those rules are exactly what
  round 2 found missing. It also needs a migration, a SPEC §4 row and a
  client-mirrored field.
- **`updated_at`** goes back to the time of the last edit, exactly as on
  `master`. Round 1's per-writer `nextTaskVersion` edits and
  `src/db/task-version.ts` are removed.

**Tests** (`server/test/http/routes/tasks.test.ts`, `describe('patch')`):
- **Writer scenarios.** One per writer, each run in the millisecond the token
  was read, and each asserting the guarded `PATCH` is refused `409` with an
  `etag` that differs from the token. They cover:
  - every path Codex reproduced
  - the claim, send-back, reorder, sprint join and removal, and subtask paths
  - offboarding, heartbeat and webhook, as writes of the column each one writes
- **Schema census.** Every table with a foreign key to `tasks`, read from
  `pragma_foreign_key_list`, is classified as either shown (naming the
  scenarios that prove it) or not shown (with a reason). A new referencing
  table fails until someone classifies it.
- **Field check.** Changing any top-level field of a real view must change the
  version.
- **Mutation-checked:**
  - hashing `updated_at` alone (round 1's design) reddens 24 tests, exactly the
    round-2 paths
  - dropping the check reddens 32
  - leaving `comment_count` out of the hash reddens the comment scenarios and
    the field check

LAI-317 (writes without `If-Match` stamp `now`) is moot for the precondition
now. It stays open only if `updated_at` itself should be strictly increasing.

## Proposed SPEC §6.4 wording (for polly to apply)

This is a new paragraph after the `PATCH /tasks/:id` body paragraph (the one
ending *"…and pages with `cursor` like any other filter (D-066)."*):

> **A `PATCH` may be conditional** (LAI-571). `GET /tasks/:id` and every
> successful `PATCH /tasks/:id` carry a strong `ETag`: the task's **version**,
> a digest of the task exactly as that response returns it, so any change a
> read of the task would show — its fields, tags and tag names, size,
> dependencies in either direction and their readiness, sprint, comments
> count, send-back — gives it a new version, whatever wrote it. A `PATCH` that
> sends `If-Match` with that value is applied only if the task's version still
> equals it, checked and written in one transaction; otherwise it is
> `409 conflict` with `details: { current, etag }`, the task as
> `GET /tasks/:id` would return it and its version, and nothing is written —
> not a field, a tag, a selection or an activity row. `If-Match` other than one
> ETag as a read sent it — `*`, weak `W/` tags and lists included — is
> `400 bad_request` with `details: { header: 'If-Match' }`. Without `If-Match`
> a `PATCH` is unconditional, as before. `updated_at` is the time of the last
> edit and is not the version. MCP's `update_task` takes no precondition.

No `TaskView` field was added, so §4.5 and the client types need nothing.
