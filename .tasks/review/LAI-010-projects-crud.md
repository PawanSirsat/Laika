---
id: LAI-010
title: Projects CRUD and membership management
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-004, LAI-006, LAI-009, LAI-037]
discovered-from:
status: review
started: 2026-08-24T08:06:21+05:30
finished: 2026-08-24T08:14:34+05:30
---

## Goal

Projects become real: create them, list the ones you can see, edit settings,
manage who is a member and at what role — all of it gated by `can()` and all of
it writing activity.

## Acceptance criteria

- [x] `GET /api/v1/projects` returns only projects the actor may see (Owner/Admin
      all; Member/Viewer their memberships), paginated per LAI-006.
- [x] `POST /api/v1/projects` (Admin+) with a unique lowercase `slug` (the URL
      identity) and a unique uppercase `prefix` (the display key, `LAI` → `LAI-42`),
      both unique per org; a duplicate of either returns `conflict`.
- [x] `GET /api/v1/projects/:slug` and `PATCH /api/v1/projects/:slug` (Admin+),
      including archive via `archived_at`.
- [x] `GET /api/v1/projects/:slug/members`, `POST .../members`,
      `DELETE .../members/:userId` — all Admin+, all validating the role value.
- [x] Removing the last Owner-capable member from a project is refused.
- [x] Every endpoint calls `can()` before touching data; every mutation writes an
      `activity` row with the correct verb.
- [x] `?updated_since=` supported on both list endpoints, tombstones included.
- [x] Tests cover each role against each endpoint (both allowed and denied), plus
      duplicate `slug`, duplicate `prefix`, and the last-owner cases.

## Notes / context

Milestone: **M2**. SPEC §4.3, §4.4, §6.4.

**Resolved by LAI-015:** the spec has `projects.slug` (lowercase, URL identity)
**and** `projects.prefix` (uppercase display key). There is no `key` column.
Routes are keyed by `:slug`.

Project UI is a separate task, groomed after this lands.

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

**413 tests** (43 new); format, lint and typecheck clean. Verified against the
**built** server:

```
create → 201     duplicate slug → 409     duplicate prefix → 409
detail → 200     patch+archive  → 200     anonymous       → 401
updated_since=0  → {"data":[{"id":"…","deleted":true}],"next_cursor":null}
remove last lead → 409 "A project must keep at least one lead"
activity         → org.created, project.created, project.archived
```

**1. AC6 needed three activity verbs that did not exist.** §4.8's vocabulary is
closed and had no `project.updated`, `project.archived` or `member.removed`, so
"every mutation writes an activity row with the correct verb" was unsatisfiable
as written. I added them to `enums.ts` with a migration, following the LAI-044
precedent where PM took the §4.8 edit — **LAI-107 filed** for that half.

Third time a task has needed a value a closed vocabulary lacked (LAI-022's error
codes, LAI-044's `org.created`, now these). LAI-107 suggests a check that
`enums.ts` and §4.8 agree, the way `errors.test.ts` now parses §6.3's table — I
did not file that separately; it is PM's call whether it earns a task.

**2. The migration dropped the append-only triggers again**, exactly as in
LAI-044 — any `activity` change is a table rebuild and SQLite drops triggers with
the table. Recreated in `0004`. The LAI-044 test caught it immediately, which is
the second time that test has paid for itself.

**3. `archived` is its own verb, not a flag on `project.updated`.** Archiving is
what removes a project from every active view; an audit reader should not have to
diff a payload to discover that is what happened.

**4. Tombstones: `archived_at` is this resource's soft-delete.** §6.3 needs
something to tombstone and projects have no `deleted_at`. An archived project
stays reachable by slug but disappears from a catching-up client's list, which is
the behaviour §6.3 is protecting.

**`member.removed` is the tombstone that could not exist.** Membership rows are
hard-deleted, so `?updated_since=` has nothing left to mark — the activity row is
the only way a client learns of a removal. Flagged in LAI-107 rather than left to
be rediscovered.

**5. Visibility filtering is done in code, not SQL.** `can()` is the only
authority (§3.3), and duplicating its rules into a `WHERE` clause is precisely how
the two drift apart. The cost is reading rows the actor cannot see; at M2 scale
that is the right trade, and it is worth revisiting only with a real project count.

**6. `assertNotLastLead` guards demotion as well as removal** — changing the last
lead to `member` leaves a project with no explicit lead just as surely as removing
them. Org admins hold implicit lead everywhere so nothing is ever unreachable, but
the explicit membership is the durable fact; losing it makes leadership depend on
somebody's org role.

**7. Org-viewer roles are refused at the write path**, not merely capped on read.
`can()` caps them either way, but storing a row that gets silently downgraded on
every read is a lie in the database.

**8. `PATCH /:slug/members/:userId` added.** AC4 lists GET/POST/DELETE, but §6.4
lists PATCH and `member.role_changed` exists solely for it — a verb with no
endpoint would have been odd. Small addition, flagged.

**Found and not folded in: `projects.repo`.** §4.3 lists it; the table has never
had it. No criterion here mentioned it, and adding an unrequested column to a CRUD
task is how scope grows quietly. → **LAI-108**, which also asks the question the
spec leaves open: may two projects track the same repo?
