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
(`claim`, `finish`, `status` and the rest, `routes/tasks.ts:270-408`). It also
does not cover what a not-found says for an MCP ref.

## Acceptance criteria

- [ ] **Cause.** From production's request or activity log, name the client,
      the transport (MCP, REST or CLI) and the token id (never the secret)
      behind the failed `start_working LAI-818` call on 2026-10-21. Record it
      here. If it was MCP with the same token that read the card, add a test
      that fails on today's code before anything changes.
- [ ] **Parity pinned.** A test calls `get_task_context` and `start_working`
      with one token, by outside id, on a card whose project prefix is not the
      outside id's prefix (the `LAIKA-618` / `LAI-818` shape). It covers a
      card in Backlog and a card already In progress and held by the caller.
      Both tools must name the same key.
- [ ] **REST writes.** `POST /api/v1/tasks/:id/claim`, `/finish` and `/status`
      either resolve a board key or an outside id the way `resolveTaskRef`
      does (readable projects only, `422 ambiguous`, never a guess), or answer
      `404` with a message saying the route takes a task id. Agree with
      LAI-800 on one resolver for the REST surface. SPEC §6.4 says which was
      chosen (a named edit).
- [ ] **A not-found says what it tried.** An MCP tool given a key-shaped ref
      that names nothing answers `not_found` with a message naming both
      lookups and the readable-projects limit. For example: *No task has the
      key or outside id "LAI-818" in a project you can read*. It must not say
      `No task with id "LAI-818"`. A test asserts the `code` and the message.
      It must not confirm that a card exists in a project the caller cannot
      read.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` from the repo root
      each exit 0, each run to its own file with its own exit code.

## Notes / context

- Filed by the ops bookkeeping pass of 2026-10-21. No code was changed.
- `server/` only, apart from the SPEC §6.4 named edit. If the CLI turns out to
  be the caller, its half goes to a separate task in `cli/`.
- Do not widen what a token can see in order to make the call succeed. If the
  cause is a token that cannot read the project, the fix is the message, not
  the access.
