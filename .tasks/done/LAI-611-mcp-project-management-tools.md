---
id: LAI-611
title: MCP P0 - sprints, task edits, assignment, and context writes for agents
area: server
assignee: core
priority: p1
depends-on: []
discovered-from: LAI-605
status: done
started: 2026-09-20T15:20:15Z
finished: 2026-09-20T15:37:56Z
---

## Goal

An agent connected over `/mcp` with a full-scope token can manage a project the
way the UI can, not only work tasks. Today the eleven tools cover the work loop
(list ready, claim, comment, move, create) and nothing else: sprints, task
edits after creation, assignees, and the project context doc are UI-only. A
real agent run (153-task import into the owner's `onroute` project on the AWS
instance) hit every one of these walls; the owner has asked for the extension.

## Acceptance criteria

- [x] `create_sprint` `{project, name, goal?, start_date, end_date, state?}`,
      `update_sprint` `{sprint, ...same optional}`, and `list_sprints`
      `{project}` (id, name, dates, state, task counts) exist and pass through
      `can()` exactly as the REST sprint routes do.
      **The field is `status`, not `state`, and its values are `planned |
      active | completed`** — see "the AC's vocabulary" below.
- [x] `set_task_sprint` `{task, sprint|null}`; `create_task` also accepts
      `sprint`.
- [x] `update_task` `{task, title?, description_md?, acceptance_md?, priority?,
      due_date?, assignee?, sprint?, tags?}` - post-creation edits, same
      validation as the REST PATCH.
      **`due_date` is skipped — there is no such column** — and the prose fields
      are spelled `description` / `acceptance`. Both below.
- [x] `assign_task` `{task, user|null}` accepting user id or email (or the same
      folded into `update_task.assignee` - implementer's call, recorded in the
      task file); `create_task` accepts `assignee`; `list_members` `{project}`.
      **Folded in. There is no `assign_task` tool.**
- [x] `update_project_context` `{project, context_md, mode: replace|append}`.
- [x] Agent guarantees hold: agents finish into `review`, never `done`;
      transition validation unchanged; every tool calls the service that calls
      `can()`.
- [x] SPEC §7.1's tool table updated by CHIEF in the same landing (§4.4
      procedure - the count assertion in the drift tests will force it).
      **Not CORE's to tick — `docs/` is CHIEF's.** The two failing assertions
      are quoted verbatim below.

## Notes / context

- The full request (owner-relayed from the consuming agent, 2026-09-20) is in
  SHELL's log for that date. This task is the P0 slice only.
- No invite/member-add tool: org access stays a human decision (the requesting
  agent itself recommended this).
- No new dependencies expected - these wrap existing services.

## Claim note (CORE, 2026-09-20)

SHELL filed this task on the `shell` branch; the file exists there at
`.tasks/backlog/`. CORE claimed it by creating this copy directly at
`.tasks/in-progress/` on `core` rather than by `git mv`, because `master` has no
copy to move. This is the two-copy shape described in CLAUDE.md §2 ("Filing a
task *for another session*"): both branches carry the id at different paths, the
merge will add rather than rename, and **whoever merges deletes the copy that is
furthest back** — here `shell`'s `.tasks/backlog/` copy — keeping this one.

---

## What shipped (CORE, 2026-09-20)

**Seven tools, taking the surface from eleven to eighteen.** Read out of
`server/src/mcp/` with the same reader `cli/test/plugin-mcp.test.ts` uses, not
counted by hand:

| Tool | Service it wraps | REST twin |
| --- | --- | --- |
| `create_sprint` | `createSprint` | `POST /projects/:slug/sprints` |
| `update_sprint` | `updateSprint` | `PATCH /sprints/:id` |
| `list_sprints` | `listSprints` + `sprintTaskCounts` | `GET /projects/:slug/sprints` |
| `set_task_sprint` | `addTasksToSprint` / `removeTaskFromSprint` | `POST /sprints/:id/tasks` |
| `update_task` | `updateTask` (+ the sprint pair) | `PATCH /tasks/:id` |
| `list_members` | `listMembers` | `GET /projects/:slug/members` |
| `update_project_context` | `getProjectContext` + `updateProjectContext` | `PATCH /projects/:slug/context` |

`create_task` additionally gained `acceptance`, `tags`, `assignee` and `sprint`.

Every one is a wrapper over the service its twin uses — no `db/` import in
`mcp/`, no second write path, `can()` inside the service against the token's
user. Each has a `PAIRS` entry in `parity.test.ts`, so all seven are covered by
the derived completeness check rather than by anybody remembering.

## Decisions, and what was rejected

**`assign_task` folded into `update_task.assignee`** (AC4 left this to the
implementer). One tool rather than two, because `updateTask` already writes
`task.assigned` when the assignee changes — a separate tool would be a second
name for one service call, and every tool costs an agent context window. The
rejected alternative was a standalone `assign_task`; the mitigation for it being
harder to *find* is that `update_task`'s description names assignment
explicitly, as does `list_members`'.

**An assignee may be a user id or a project member's email.** An id passes
through untouched, so the write is identical to the REST one. An email is
resolved against `listMembers` — which needs only `project.read`, where the org
directory (`listUsers`) is behind `member_list.read`. Rejected: resolving
against the whole org, which would make assigning work to a non-member the easy
path and would need a permission the task does not.

**Sprints are addressed by id, never by name.** `update_sprint` takes no
project, so a name would have to be resolved across every readable project and
two projects may both have a "Sprint 3". `list_sprints` and `create_sprint` both
put the id in their markdown as well as their payload. Rejected: name resolution
scoped to the task's project for `set_task_sprint` only — one parameter meaning
two different things across two tools is worse than one extra call.

**Dates are `YYYY-MM-DD`, with unix-ms still accepted.** §4.15 gives sprint
dates date-only semantics, which is why the AC's own names (`start_date`,
`end_date`) are the better ones and were kept. The round-trip check in
`toTimestamp` is load-bearing and was **measured, not assumed**:
`Date.parse('2026-02-31T00:00:00.000Z')` does not fail — it returns the 3rd of
March. `2026-13-01` is the case that does return `NaN`, and it is the one nobody
would have got wrong.

**`sprintTaskCounts` is a new service function, not a count of a page.** Every
list service returns `limit + 1` rows, so bucketing `listTasks` would give a
silently short number past the page size. `server/test/services/sprints.test.ts`
proves the difference rather than arguing it: at 205 tasks the grouped count says
205 and the 200-limit page returns 201.

**`append` is read-then-write, and can lose a concurrent addition.** Noted in
the code rather than papered over: `context_md` is a single markdown field with
no revision column, so two agents appending in the same instant can drop one.
`mode` is therefore **required** — there is no safe default between adding a
paragraph and discarding somebody's document.

**`projectSlugById` added to `services/projects.ts`**, replacing the private
`slugOf` scan in `read-tools.ts` that the write side would otherwise have
duplicated. One indexed lookup, one definition, and an unreadable project now
raises an `ApiError` the tool renders as a §6.3 refusal instead of a bare
`Error` the SDK would surface as a crash.

## Where the AC and the artefacts disagreed

Each of these was checked against the artefact rather than against the task
file's description of it (CLAUDE.md §2).

**`state?: planned|active|closed` is wrong twice.** `db/enums.ts:183` reads
`SPRINT_STATUSES = ['planned', 'active', 'completed']` — there is no `closed` —
and the field is called `status` in the enum, the service, the REST body and
§6.4. The tool uses `status` with the real three values.

**`due_date` does not exist.** `grep -n 'dueDate\|due_date' server/src/db/schema.ts`
returns nothing; tasks carry `started_at` and `completed_at`, which are
**actuals, not a plan** — D-014 gives tasks no planned dates on purpose. Adding
the column is a schema change and its own task, so `update_task` has no
`due_date` and no tool invents one. **This is the one sub-feature of AC3 that
did not ship.**

**`description_md` / `acceptance_md` are spelled `description` / `acceptance`.**
`create_task` has taken `description` since LAI-408, and an agent that files a
task and then edits it must not find the second call spells the field
differently. Consistency within the MCP surface beat consistency with the REST
body, which the MCP surface already departs from (`body` for `body_md`,
`blocked_by` for a dependency call).

**"Same validation as the REST PATCH" holds for semantics, not for string
caps.** Same fields, same nullable-versus-absent distinction, same enums, same
`can()` calls, same service. The length bounds are `create_task`'s existing MCP
ones — 200/50k/10k against the route's 300/100k/10k — because that file already
made that call and two different caps inside one tool surface would be the
drift, not the alignment.

## The §4.4 red this carries, with the exact assertions

Two owners beyond CORE, which is the D-056 shape: the third only became visible
once the tools existed.

**CHIEF — `docs/SPEC.md`.** `server/test/mcp/parity.test.ts`, two failures:

```
FAIL test/mcp/parity.test.ts > §7.1 lists the tools the server actually serves
     > names exactly the registered tools, in neither direction short
AssertionError: expected [ 'add_comment', …(17) ] to deeply equal
                        [ 'add_comment', 'create_task', …(9) ]
+   "create_sprint"  +   "list_members"  +   "list_sprints"
+   "set_task_sprint"  +   "update_project_context"  +   "update_sprint"
+   "update_task"

FAIL test/mcp/parity.test.ts > §7.1 lists the tools the server actually serves
     > agrees with §7.2 about how many have REST twins
AssertionError: §7.2 says "ten" tools have twins; the server has 17:
                expected 'ten' to be 'seventeen'
```

Turned green by adding the seven rows to §7.1's table and changing §7.2's
sentence *"cover the ten tools that have twins"* to **seventeen**. Seventeen of
eighteen, because `log_unlisted_work` is the one exemption (D-024). The `words`
array the second assertion indexes lives in `parity.test.ts` and has already been
extended through twenty — that half is done.

**SHELL — `cli/` and `plugin/`, filed as LAI-176 (p1).**
`cli/test/plugin-mcp.test.ts` spells the tool set out by name:

```
    not ok 2 - §7.1 and the registry name exactly the same tools
    not ok 3 - and they are these eleven
not ok 20 - the tool surface, from both sides
# pass 73
# fail 2
```

`not ok 2` compares the registry against §7.1 and goes green on **CHIEF's** half
alone. `not ok 3` is the hardcoded eleven and is SHELL's. `plugin/README.md`
says "eleven" in two more places. **CORE edited neither file** — §4.4's
`clientOmits` case, where there is no entry to take that is not a crossing.

## Gate

Run per CLAUDE.md §5, each redirected to its own file with its own exit code.

| | exit | result |
| --- | --- | --- |
| `pnpm lint` (root) | **0** | clean |
| `pnpm format` (root) | **0** | clean |
| `pnpm test` (root) | **1** | `cli` fails first and `pnpm -r` bails, so the workspaces were also run individually |
| `pnpm test` in `server/` | 1 | **1977 passed, 2 failed** — both the SPEC assertions above, nothing else |
| `pnpm test` in `server/web/` | **0** | 897 passed, 0 failed |
| `pnpm test` in `cli/` | 1 | 73 passed, 2 failed — LAI-176 |

**Every failure in the gate is one of the two halves named above.** Nothing
CORE owns is red.

---

## Accepted (CHIEF, 2026-09-20)

**Accepted.** Merged as `1225d9f`; the `docs/` half is `376c08c`.

**What was checked, against the code rather than against this file.** The tool
names were read out of `server/src/mcp/` — seventeen `registerTool` calls in
`read-tools.ts` and `write-tools.ts` plus `laika_whoami` in `server.ts`, which is
the eighteen §7.1 now lists. Every new tool reaches data only through
`services/`; the two new service functions, `projectSlugById` and
`sprintTaskCounts`, each assert `project.read`, which is an existing §3.1 action
and not an invented one. The only removals in `write-tools.ts` are inside
`create_task`, refactoring its schema into the shared `TASK_FIELDS` — so
`finish_task`, `update_status` and `changeStatus` are byte-for-byte untouched,
which is what makes "agents finish into review" and "transition validation
unchanged" true rather than asserted. `update_task` carries no `status` in its
`strictObject`, and the test at `project-tools.test.ts:682` proves both halves of
that: the schema does not mention it, and a call passing it is refused rather
than ignored.

**The assertions are specific.** `must()` asserts every setup write's status, so
the LAI-407 shape — a fixture that 422s into a test asserting against state that
was never built — cannot occur here. The four `isError` checks are each paired
with something only the real refusal path produces: the `YYYY-MM-DD` message, the
task still `backlog`, the context still empty. Eleven assertions pin a §6.3
`code`.

**The §4.4 half.** §7.1 gained the seven rows and `create_task`'s four new
params; §7.2's sentence moved from *"ten"* to **"seventeen"** (eighteen served,
`log_unlisted_work` exempt under D-024). The vocabulary the AC got wrong is now
recorded in §7.1 as the code's, not as this task's: `status` over `state` with no
`closed`, sprints by id, `YYYY-MM-DD`, `description`/`acceptance`, assignee by id
or member email, no `assign_task`, no `due_date`, no `status` on `update_task`,
and `mode` required.

**`due_date` did not ship and that is correct.** D-014 gives tasks no planned
dates; adding the column is a schema change and its own task. Recorded in §7.1 so
the next reader does not file it as a gap.

**What remains.** `LAI-176` (SHELL, p1) is the third half — `cli/` and
`plugin/README.md` still say eleven. It is filed and in `.tasks/backlog/`.

**A duplicate is still in flight.** SHELL filed this task and the `shell` branch
carries its own copy at `.tasks/backlog/`. Per §2 the copy furthest back is the
one that goes; it will surface as a two-copy collision when `shell` next merges
`master`, and whoever merges deletes the `backlog/` copy and keeps this one.
