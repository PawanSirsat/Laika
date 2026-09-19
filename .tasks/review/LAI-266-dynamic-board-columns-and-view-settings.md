---
id: LAI-266
title: 'Dynamic board columns, and a Jira-style View settings panel'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-09-19T10:00:20Z
finished: 2026-09-19T11:44:17Z
---

## Scope exception — read this first

**This task edits `server/src`, which CLAUDE.md §1 assigns to CORE.** The owner
granted the crossing directly, in response to a question that laid out the
alternative (file the server half and wait):

> *"You authorise me to do both."*

§1 says a scope exception is granted only by a task file that **names what will
be touched**, so it is named here, file by file. Nothing outside this list is
touched in `server/`:

| File | Change |
| --- | --- |
| `server/src/db/schema.ts` | two new tables, one new `projects` column |
| `server/src/db/migrations/0023_*.sql` + `meta/` | generated, committed |
| `server/src/db/backfill.ts` | `backfillBoardColumns` beside the existing one |
| `server/src/db/migrate.ts` | one call added to `runMigrations` |
| `server/src/services/board-columns.ts` | **new** |
| `server/src/services/task-lifecycle.ts` | the transition rule takes a principal rule |
| `server/src/services/tasks.ts` | pass the rule at `changeStatus` and `finishTask` |
| `server/src/services/projects.ts` | `createProject` seeds default columns |
| `server/src/services/setup.ts` | first-boot project seeds default columns |
| `server/src/auth/resolve-actor.ts` | `isAgentPrincipal` added |
| `server/src/http/routes/board-columns.ts` | **new** |
| `server/src/app.ts` | mount the new routes |
| `server/test/**` | the mirrored tests those modules require |
| `server/test/tooling/schema-spec-drift.test.ts` | two `TABLES_NOT_IN_SPEC` entries |
| `server/test/tooling/response-type-coverage.test.ts` | one `UNPAIRED` entry |
| `server/test/helpers/db.ts` | `seed()` seeds default columns |

**It is not a licence to reshape CORE's design.** Per §1, *"a named edit is not a
design change to someone else's file"* — if any of this turns out to need
rethinking how CORE's code works rather than adding to it, it stops and goes back
to them.

**`docs/` is not included and is not touched.** It is filed as **LAI-264** and
is CHIEF's. This task lands red on one guard until it merges; see below.

## Goal

The board's lanes are hardcoded — `BOARD_COLUMNS` is a frozen five-value array
and `.kanban` is literally `repeat(5, …)`. A space cannot gain a column, drop one,
or reorder what it has. `src/demo/wip.ts` states the underlying fact: *"There is
no board-column entity at all — columns are the fixed `status` enum."*

Make columns real, per-project, configurable rows; and add the View settings
panel the owner asked for.

**Columns map to statuses, Jira-style, and the six statuses do not change.** That
is what keeps this safe: `done` drives throughput (`services/metrics.ts:111`),
`in_progress` + `review` drive Capacity (`services/presence.ts:191`),
`in_progress` drives the stale cron (`jobs/jobs.ts:142`), and MCP speaks statuses
to agents. A column is a *view* over statuses, so none of that is touched.

## The transition table splits by principal

`services/task-lifecycle.ts:28` refuses `todo → done`, `backlog → review` and
more. With five fixed lanes that is invisible; with user-made columns it is the
board's most obvious gesture failing. The owner chose to widen it for people:

- **An interactive human** may move a card between any two non-`cancelled`
  statuses.
- **The seam is `actor.token`, not `isSystemPrincipal`.** `isSystemPrincipal`
  means `kind === 'system'` — cron and webhooks — so a token-bearing agent is an
  ordinary `ResolvedActor` and that predicate would have handed *agents* the
  widened rule. `policy/can.ts:57` documents the right field: `token` is *"Absent
  or `null` when the request arrived on a session cookie"*. `activityActor`
  (`resolve-actor.ts:168`) already defines "agent" this way for §4.8 attribution.
- **Agents keep `ALLOWED_TRANSITIONS` unchanged**, so SPEC §5's *"`done` is never
  set by `finish_task`. Agents do not self-certify"* survives intact.
- Unchanged for everyone: the `review` gate; `done → cancelled` refused;
  `cancelled → backlog` the only way out; a no-op still `409`.

**The human table is derived from the agent one, never hand-written**, so the
cancellation edges cannot drift apart.

## The model

```
board_columns          id · project_id · name · position · hidden · created_at · updated_at
board_column_statuses  project_id · status · column_id · is_primary · created_at
                       PRIMARY KEY (project_id, status)
                       FOREIGN KEY (project_id, column_id) → board_columns(project_id, id)
```

- The **composite FK** is what stops project A's status mapping to project B's
  column. Checked against real SQLite with `foreign_keys = ON`. Note
  `foreignKey()` is **used nowhere in `server/src` today** — read
  `db:generate`'s output before trusting it.
- `board_column_statuses.project_id` needs **its own** `CASCADE` to `projects`,
  or `CASCADE`-on-column plus `RESTRICT`-on-mapping makes deleting a project
  fail. Reproduced.
- **`is_primary` is the drop target**, and it is the **first** status in the
  column's order — configuration, not a heuristic, so the admin who orders
  `todo` above `backlog` has decided what a drop means.
- **No `CHECK (position >= 0)`.** Reorder parks positions negative
  mid-transaction. Measured: a single `CASE` update and a naive per-row rewrite
  both fail `UNIQUE constraint failed`, because SQLite checks unique indexes
  per row and has no deferrable unique constraint.

**Defaults for a new space — four visible columns:**

| position | Column | Statuses (ordered) | primary |
| --- | --- | --- | --- |
| 0 | To do | `todo`, `backlog` | `todo` |
| 1 | In progress | `in_progress` | `in_progress` |
| 2 | Review | `review` | `review` |
| 3 | Done | `done` | `done` |
| 4 | Cancelled (`hidden`) | `cancelled` | `cancelled` |

**`todo` is first deliberately, and the order is not cosmetic.** There is no
`.lane-dot-backlog` rule — `lane-dots.test.ts:41` asserts its absence on purpose
— so a "To do" column whose primary is `backlog` renders with the grey fallback
dot. With `todo` primary the default board is chromatically identical to today's,
and the List view's pill agrees with the lane's label.

**Existing spaces keep exactly what they show today**: backfilled to five visible
columns named verbatim from `COLUMN_LABELS` (Backlog · To do · In progress ·
Review · Done), one status each, plus the hidden Cancelled.

## Acceptance criteria

**Columns**

- [x] A lead can create, rename, delete and reorder columns on a space, and the
      order survives a reload because it is stored, not local.
- [x] Deleting a column **requires** a target for its statuses; the dialog names
      the real number of tasks affected and says no task is deleted.
- [x] Deleting the last column is refused, with the reason on screen.
- [x] Editing a column's statuses moves them rather than copying: after any
      sequence of edits, **every status except `cancelled` is in exactly one
      column, and no status is in two.** Asserted against the table, not the
      service's own return value.
- [x] A new project gets the four columns above — **including the first-boot
      project** (`setup.ts`) and `seed()`, not only `createProject`.
- [x] A project that existed before this migration renders an **identical** board
      afterwards.
- [x] A member and a viewer get no column affordances at all (absent, not
      disabled), and the endpoints refuse them.

**Drag**

- [x] A column reorders by dragging its header grip, with a drop indicator that
      does not reflow the other lanes.
- [x] **The keyboard equivalent ships in this task** — a `.lane-order` select
      following `.lane-move`'s existing clip/focus pattern — and is tested with
      no drag events at all.
- [x] A card drag cannot reorder a column and a column drag cannot move a card.
      Both directions tested; this is what the separate MIME type exists for.
- [x] A rejected reorder snaps back and names the reason.
- [x] Dropping a card on a multi-status column sets that column's **primary**
      status; dropping a card on a column that already holds its status sends
      **nothing**.
- [x] `todo → done` by drag now lands, **and** the MCP `update_status` tool still
      refuses it for a token-bearing caller. Both halves, or the split is
      unproven.

**View settings**

- [x] The panel opens from the space slot, closes on Escape, scrim and blur, and
      returns focus to its trigger.
- [x] Nine card fields toggle. The four that do not — title, the key/open button,
      the blocked banner, the `deps ?` marker — are **absent from the list with a
      sentence**, not greyed.
- [x] A hidden field is **not rendered**, proven by `locator(...).count() === 0`;
      a `display:none` node would still count 1.
- [x] Density and column width work; the board still scrolls rather than
      squeezing at 8 columns, tested with an 8-column fixture.
- [x] Hide-done-after-N-days is a **project setting**, not a personal one, and
      the board discloses what it is hiding in `.board-scope`.
- [x] Group by assignee / priority / sprint renders, is **read-only**, says so on
      screen, and hides the column affordances while grouped. LAI-288 carries the
      drag.
- [x] Field, density and width choices persist per project in `localStorage` and
      do **not** travel in the URL; filter and group **do**.

**Not regressing**

- [x] `card-anatomy`, `task-card`, `card-hit-area`, `card-click` and
      `stale-marker` are **unchanged and green**. Defaults are all-fields-on, so
      a board with no stored preferences is identical to today's. If one goes
      red, a default changed and the change is wrong.
- [x] `sprint-strip.test.ts:192` (all lanes one height) is **unchanged and
      green** — if it fails, `align-items: stretch` broke.
- [x] Repo-root `pnpm test`, `pnpm lint` and `pnpm format` all exit `0`.

## Known red, and what turns it green

Per CLAUDE.md §4.4 step 1, the failure is named here rather than discovered at
review. **One guard, and only this one:**

```
server/test/tooling/schema-spec-drift.test.ts
  schema.ts defines table "board_columns" — no §4 section describes it,
  and no exemption explains why
```

Carried by two `TABLES_NOT_IN_SPEC` entries naming **LAI-264**, which is CHIEF's
`docs/` half. The expiry is mechanical, not a reminder: the sibling test *"drops
a table exemption once §4 describes the table"* goes red the moment §4.20 lands,
and stays red until the entries are deleted. Re-run after every `git merge
master`, per §4.4 step 2.

**`endpoint-coverage.test.ts` needs no entry** — its usual §4.4 problem is that
`NO_BROWSER_CALLER` lives in SHELL's tree while CORE serves the endpoint. Owning
both halves removes it: the callers ship with the routes.

**`policy-spec-drift.test.ts` stays green.** `project.settings.edit` already
exists and §3.2's *"Edit project settings and `context_md`"* row already maps to
it. **No new action, no new §3 row** — the *"Rename or delete a tag
project-wide"* row is the precedent for a second operation under one action.

**No new `ACTIVITY_TYPES` verb.** D-060 made this exact call for this exact
reason; CLAUDE.md §4.4's rule is *"a verb added to `ACTIVITY_TYPES` is always
three owners."* Column changes write `project.updated` with
`{ entity: 'board_column', action, … }`, the shape `services/sprints.ts` used.

## Notes / context

**Why this is one task and not five.** The crossing has to be reviewed as a unit
— the schema, the endpoints and the callers are the thing the owner authorised —
and the drift exemption must land with the table it exempts. Splitting would put
a half-landed contract on `master` and need the §4.4 dance for a boundary that
exists only inside this task.

**LAI-267 and LAI-268 are unblocked by this**, and both should be re-read once it
lands. Both say *"there is no column table"*; `board_columns` is that table, and
its docblock should say `wip_limit` and `reviewer_id` land there so nobody files
a third one.

**Two follow-ups filed:** LAI-264 (`docs/`, CHIEF, p1) and LAI-288 (drag under
group-by). **LAI-265** was found while verifying the principal seam and is
unrelated to this diff — `claimTask` hardcodes `from: 'todo'` in an append-only
activity row.

**The board loads the whole project in one request** (`use-board.ts:70`,
`limit: 200`) and groups client-side, so a multi-status column needs no new
`?status=` filter. This was checked, because a per-lane fetch would have made
multi-status columns an API problem rather than a rendering one.
