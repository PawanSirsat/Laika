---
id: LAI-856
title: 'A board key in a project the caller cannot read answers forbidden, so the key confirms the card exists'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-852
status: backlog
---

## Goal

Asking for a task the caller cannot read gives the same answer as asking for
one that does not exist. Today that holds for an outside id but not for a
board key.

## Found (PR #2 review of LAI-852, 2026-10-21)

- `taskIdByKey` (`server/src/services/tasks.ts:586-607`) resolves a board key
  "whoever may read it", with no read check.
- `getTask` then asserts `project.read` and answers `forbidden`
  (`tasks.ts:698`). `claimTask` asserts `task.claim` the same way
  (`tasks.ts:1196`).
- So `get_task_context LAIKA-5` from a token that cannot read that project
  answers `forbidden`, while a key that names nothing answers `not_found`. The
  difference confirms the card exists.
- Board keys are sequential (`LAIKA-1` … `LAIKA-N`), so walking them counts
  another project's cards. No title or body leaks, only existence and count.
- LAI-852 makes an outside id answer `not_found` for an unreadable card. After
  it lands, keys and outside ids answer this case differently unless this task
  is done.
- SPEC does not say which answer an unreadable task should get. A search of
  `docs/SPEC.md` finds no rule.

## Acceptance criteria

- [ ] **Decision first.** CHIEF and the owner decide what a task in a project
      the caller cannot read answers, asked by board key: `not_found`,
      identical to a key that names nothing, or `forbidden`, kept on purpose.
      Record it in `DECISIONS.md` and in SPEC §6.3 (a named edit). If
      `forbidden` is kept, SPEC says board keys are not secret, and this task
      closes with no code change.
- [ ] **If `not_found`:** `get_task_context`, `start_working` and
      `update_status` over MCP, and `GET /api/v1/tasks/:ref` once LAI-800
      lands, given the board key of a card in a project the token cannot read,
      answer `not_found`. The message is byte-identical to the one the same
      tool gives for a key that names nothing, with the same prefix and a
      number no task has.
- [ ] **Tests.** One test per tool or route listed above. Each asserts the
      status (for REST), the `code` and the exact message for both refs, and
      fails on today's code.
- [ ] A caller who **can** read the project still gets `forbidden` for an
      action they may not take, for example a viewer claiming a card. A test
      keeps that.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` from the repo root
      each exit 0, each run to its own file with its own exit code.

## Notes / context

- Filed by the ops bookkeeping pass of 2026-10-21, because the PR #2 review
  asked for board keys to be in LAI-852 or in a task of their own. No code
  was changed.
- `server/` only, apart from the SPEC §6.3 named edit and the decision entry,
  which are CHIEF's.
- Do not change what a token can see. This is about what a refusal reveals,
  not about access.
