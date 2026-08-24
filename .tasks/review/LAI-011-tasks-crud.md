---
id: LAI-011
title: Tasks CRUD — statuses, dependencies, discovered-from, activity
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-010, LAI-037]
discovered-from:
status: review
started: 2026-08-24T09:06:23+05:30
finished: 2026-08-24T09:14:36+05:30
---

## Goal

The heart of the product: tasks that can be created, listed, filtered, claimed,
transitioned and linked — with the derived `ready` computation that the MCP
`list_ready_tasks` tool will later depend on.

## Acceptance criteria

- [x] `POST /api/v1/projects/:slug/tasks` and
      `GET /api/v1/projects/:slug/tasks` with filters `status`, `assignee`,
      `priority`, `ready`, plus `updated_since` and cursor pagination.
- [x] `GET /api/v1/tasks/:id` and `PATCH /api/v1/tasks/:id`.
- [x] `POST /api/v1/tasks/:id/claim` is a compare-and-swap: sets assignee +
      `in_progress` only if unassigned; a second claimant gets `409 conflict`
      **with the current assignee in the body**. Test proves it under concurrency.
- [x] `POST /api/v1/tasks/:id/status` validates transitions per SPEC §5; moving
      to `review` requires assignee, Admin or Owner.
- [x] Dependency endpoints add/remove links; cycles and self-links are rejected.
- [x] `discovered_from` is settable at creation and is **provenance only** — it
      never blocks readiness. Test asserts a discovered task can be worked while
      its parent is open.
- [x] `ready` is computed, never stored: `status IN ('backlog','todo')` +
      unassigned + all dependencies `done` (SPEC §4.5). `todo` is
      groomed-and-ready, `backlog` is unrefined; **both** count as ready.
- [x] Every mutation writes exactly one `activity` row with the right verb; no
      mutation path skips `can()`.
- [x] Per-project numbering yields `LAI-1`, `LAI-2`, … with no duplicates under
      concurrent creates.

## Notes / context

Milestone: **M2**. SPEC §4.5, §5, §6.4. Read §5 before implementing transitions.
Statuses are `backlog | todo | in_progress | review | done | cancelled` — `todo`
was added in the spec merge and earlier task text omits it.

The claim CAS is the API twin of the file-move lock the build sessions use —
getting it wrong means two agents on one task, so test it properly.

Comments (`/tasks/:id/comments`) are a follow-up task, groomed when this is in
review.

No new dependencies.

---

## PM note — 2026-08-24: build through the service layer

**Now depends on LAI-037.** `docs/CONVENTIONS.md` §2 is binding for this task:
the route handler is transport only, and every read and write goes through a
function in `server/src/services/` that takes an `Actor`.

This is not style. SPEC §7 makes every MCP tool "a thin wrapper over the same
service layer the REST routes use". Logic that lands in a handler here has to be
extracted again in M3, and the parity tests in §13.3 would be the only thing
holding the two paths together instead of the structure. `no-restricted-imports`
will fail `pnpm lint` if a route imports `db/` directly.

LAI-037 ships one worked example (`/api/v1/me`) to copy the shape from.

---

## PM pre-flight correction — 2026-08-24

**Project routes are `:slug`, not `:id`.** The criteria above said
`/api/v1/projects/:id`; SPEC §6.4 keys every project route by `:slug`, and this
task's own LAI-015 note already said so. The criteria and the note contradicted
each other. Corrected to `:slug`.

**Task routes stay `:id`** — `/api/v1/tasks/:id` is correct per §6.4. Projects
have a human-facing URL identity; tasks are addressed by ULID.

Found by pre-flighting the task against the spec before it was claimed, rather
than by the builder hitting it mid-task. Fifth authoring error of this kind
today, and the first caught before it cost anyone.

---

## Notes at review — builder-a

**477 tests** (60 new); format, lint and typecheck clean. Verified against the
**built** server:

```
create        → key LAI-1, ready true      second → LAI-2
dependency    → ready flips to false       cycle  → 422
claim         → 200                        re-claim → 409 with assignee_id in details
backlog→done  → 422 "Cannot move a task from backlog to done", allowed listed
activity      → org.created, project.created, task.created ×2,
                task.dependency_added, task.status_changed
```

**1. §5 draws the forward path and does not enumerate the reverse edges.** I had
to decide them, so `task-lifecycle.ts` states the table as data with the argument
for each choice beside it:

- grooming moves both ways (`backlog ⇄ todo`);
- work can go back (`in_progress → todo/backlog`, `review → in_progress`) —
  forbidding it pushes people to cancel and recreate, which loses the history the
  `activity` table exists to keep;
- **`done` reopens only into `in_progress`** — a finished thing needing more work
  is in progress, not unrefined;
- **`done → cancelled` is refused** — reopening is the operation actually wanted;
- a no-op transition is refused, because it would write an `activity` row
  claiming a change happened.

All 36 status pairs are asserted, allowed and refused alike. If any of these
readings is wrong, the table is one edit and the tests will say exactly what
changed.

**2. Sending to `review` allows a project lead.** AC4 said "assignee, Admin or
Owner"; §5 says "the assignee, a project `lead`, or org Admin/Owner". Spec wins
(D-011), and there is a test for the lead case and for a plain member being
refused.

**3. `ready` includes both `backlog` and `todo`, as AC7 insists.** §4.5 is
explicit that the distinction is for humans triaging. Omitting `todo` would make
`list_ready_tasks` (§7.1) miss precisely the tasks most ready to start — the
failure would look like an empty queue rather than a bug.

**4. Both concurrency claims are proven with real worker threads, and both were
checked for teeth.** Four connections × 15 creates gives a dense `1..60` with no
duplicates; six connections claiming one task give exactly one winner and five
`conflict`. Removing the `assignee_id IS NULL` predicate from the swap makes the
claim test fail with more than one winner — so it is testing the CAS, not the
absence of parallelism.

**5. `task.dependency_removed` was missing from §4.8's vocabulary.** AC5 asks for
removal and AC8 for a verb per mutation; there was none. Added to `enums.ts` with
migration `0005`, following the LAI-044/LAI-010 precedent. **Fourth time** a task
has needed a value a closed vocabulary lacked — LAI-107's suggestion of a
mechanical `enums.ts` ↔ §4.8 check looks better with each occurrence. §4.8 needs
the matching edit.

**6. The migration dropped the append-only triggers for the third time**, and the
LAI-044 test caught it again. Recreated in `0005` with a comment saying so. This
is now reliable enough to be worth automating: every `activity` change is a table
rebuild, and the rescue is identical each time.

**7. `assignee=none` is how you ask for unassigned work.** Over a query string
every value is a string and `""` is indistinguishable from absent, so a sentinel
is needed; `none` reads better than the alternatives.

**8. PATCH deliberately cannot change status.** §5 makes transitions validated,
and a generic field update would route around the table. `POST /:id/status` is
the only path, and reassignment records `task.assigned` rather than a status
change — §5 says so explicitly.

**Comments are not in this task**, per the notes — they are the follow-up.
