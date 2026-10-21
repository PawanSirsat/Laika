---
id: LAI-852
title: 'start_working answered not found for LAI-818 while get_task_context found the card: find which path answered, and make a not-found say what it looked up'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-818
status: backlog
---

## Goal

A task named by its board key or its outside id is found, or refused, the same
way by every way into Laika. When it is refused, the error says what was looked
up, so a reader can tell a missing card from a token that cannot see it.

## Found (ops bookkeeping, 2026-10-21)

On 2026-10-21 an agent called `start_working` on `LAI-818` and got *not
found*. `get_task_context LAI-818` found the card (`LAIKA-618`,
`external_ref: LAI-818`, created with that ref on 2026-10-20). The report went
to `log_unlisted_work`.

**On master the MCP path cannot produce that split for a single token.**

- `start_working` resolves the ref with `resolveTaskRef(db, task, actor)`
  (`server/src/mcp/write-tools.ts:311`). `get_task_context` does the same
  (`server/src/mcp/read-tools.ts:257`). Both lines arrived in one commit,
  `7ab1ca44` (LAI-780), so no deploy carried one without the other.
- `resolveTaskRef` (`server/src/services/tasks.ts:564-574`) tries the board
  key, then the outside id among projects the actor can read
  (`server/src/services/outside-ids.ts:78-98`). Otherwise it returns the ref
  unchanged.
- `getTask` (`tasks.ts:697`) and `claimTask` (`tasks.ts:1195`) both start with
  `requireTask`, which throws `No task with id "<ref>"` (`tasks.ts:465`). A ref
  that did not resolve fails both tools. A ref that did resolve fails neither,
  at least not with *not found*: a claim refusal is `conflict`, `unprocessable`
  or `forbidden`.
- `server/test/mcp/write-tools.test.ts:979-997` already proves
  `start_working` by outside id on a card whose prefix differs from the id's.

So the call that failed was most likely one of these:

- a different token from the one that read the card, unable to see the
  project;
- a client pointed at a different Laika instance;
- REST. `POST /api/v1/tasks/:id/claim` passes the path segment to `claimTask`
  unresolved (`server/src/http/routes/tasks.ts:292`), so `LAI-818` there
  answers exactly `404 No task with id "LAI-818"`.

The message does not say which of these happened. Today it is the same text
in every case.

**Why LAI-800 does not cover it.** LAI-800 asks for `GET /api/v1/tasks/:ref`
alone (`.tasks/backlog/LAI-800-rest-task-by-key.md:20`) and for the CLI's
`cardByKey` read. It does not cover the REST write routes that take `:id`
(`server/src/http/routes/tasks.ts:270-408`). It also does not cover what a
not-found says for an MCP ref.

**REST scope of this task.**

- **In:** `POST /:id/claim` (`:277`), `POST /:id/finish` (`:296`) and
  `POST /:id/status` (`:338`). These are the REST twins of `start_working`,
  `finish_task` and `update_status`.
- **Out, unchanged, keeping today's message:**
  - `PATCH /:id` (`:270`)
  - `POST /:id/accept` (`:327`) and `POST /:id/send-back` (`:331`), which are
    a person's review decisions
  - `POST /:id/reorder` (`:365`)
  - `POST /:id/dependencies` (`:372`) and `DELETE /:id/dependencies/:depId`
    (`:408`)
  - `PUT` and `DELETE /:id/watch` (`:393`, `:398`)
  - every `GET`, which is LAI-800's

**Board keys are out of scope.** `taskIdByKey`
(`server/src/services/tasks.ts:586-607`) resolves a key whoever may read it.
`getTask` then answers `forbidden` (`tasks.ts:698`). A board key therefore
already confirms that a card exists in a project the caller cannot read. That
needs its own decision about what an unreadable task answers. It is filed as
LAI-856 and not changed here.

## Acceptance criteria

- [ ] **Cause, from the request log only.** The log can settle REST and
      nothing else:
      - The request log (`server/src/http/middleware/logger.ts:44-47`)
        records `token_id`, `method`, `path` and `status` for a call, and
        nothing about its body.
      - An MCP refusal is an ordinary tool result marked `isError`
        (`server/src/mcp/present.ts:66-73`), so a `/mcp` line names no tool,
        no ref and no outcome.

      Search production's log for 2026-10-21:
      - A `404` on `POST /api/v1/tasks/LAI-818/claim` settles it as REST.
        Record that line's time and `token_id` here, never a secret.
      - If the window holds only `/mcp` lines, record "not determinable from
        the log" and go on to the other criteria. No other digging is asked
        for.
- [ ] **Parity pinned.** Extend the existing test at
      `server/test/mcp/write-tools.test.ts:979-997` (one token, outside id
      `LAI-780`, card `COR-1`) with two more cases:
      - a card in Backlog;
      - a card already In progress and held by the caller.

      In each case both `get_task_context` and `start_working`, called by the
      outside id, must return the key `create_task` returned for that card.
      Assert against that value, not against each other, so that two tools
      agreeing on the wrong card fails.
- [ ] **REST writes resolve the outside id.** `POST /api/v1/tasks/:ref/claim`,
      `/finish` and `/status` resolve a board key or an outside id the way
      `resolveTaskRef` does (readable projects only, `422 ambiguous`, never a
      guess). An id keeps working as today. Each of the three routes gets its
      own test with two cases:
      - called with an outside id carried by a readable card: `200`, and the
        body's `key` equals the key `create_task` returned for that card;
      - called with an outside id that no readable card carries: `404`,
        `code: "not_found"`, and the message exactly
        `No task has the key or outside id "EXT-901" in a project you can read`.
        Today's `No task with id "EXT-901"` (`tasks.ts:465`) must fail it.

      SPEC §6.4 says these three take a key or an outside id (a named edit).
      Agree one resolver for the REST surface with LAI-800.
- [ ] **A not-found says what it tried.** Every MCP tool whose `task` argument
      goes through `resolveTaskRef` must use the new message, and
      `get_task_context` and `start_working` at the least. Given a key-shaped
      ref that resolves to nothing, the tool answers `not_found` with the
      message exactly `No task has the key or outside id "<ref>" in a project
      you can read`, never `No task with id "<ref>"`.

      Tests, for `get_task_context` and for `start_working`:
      - call the tool with `EXT-901` while no card carries it, and record the
        code and the message;
      - then give `external_ref: EXT-901` to a card in a project this token
        cannot read, set by a member of that project, and call the tool
        again;
      - the second answer must be `not_found` with a byte-identical message,
        so an outside id never confirms that a card exists in a project the
        caller cannot read.

      Ids that are not key-shaped keep `No task with id "<id>"`.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` from the repo root
      each exit 0, each run to its own file with its own exit code.

## Notes / context

- Filed by the ops bookkeeping pass of 2026-10-21. No code was changed.
  Criteria revised on the PR #2 review, before anyone claimed it.
- `server/` only, apart from the SPEC §6.4 named edit. If the CLI turns out to
  be the caller, its half goes to a separate task in `cli/`.
- Do not widen what a token can see in order to make the call succeed. If the
  cause is a token that cannot read the project, the fix is the message, not
  the access.
- **Not in scope and not filed:** logging the MCP tool name and its refusal
  code on the `/mcp` line. That would have settled the cause criterion. It is
  the owner's call whether it becomes a task.
