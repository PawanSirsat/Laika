---
id: LAI-611
title: MCP P0 - sprints, task edits, assignment, and context writes for agents
area: server
assignee: core
priority: p1
depends-on: []
discovered-from: LAI-605
status: in-progress
started: 2026-09-20T15:20:15Z
---

## Goal

An agent connected over `/mcp` with a full-scope token can manage a project the
way the UI can, not only work tasks. Today the eleven tools cover the work loop
(list ready, claim, comment, move, create) and nothing else: sprints, task
edits after creation, assignees, and the project context doc are UI-only. A
real agent run (153-task import into the owner's `onroute` project on the AWS
instance) hit every one of these walls; the owner has asked for the extension.

## Acceptance criteria

- [ ] `create_sprint` `{project, name, goal?, start_date, end_date, state?}`,
      `update_sprint` `{sprint, ...same optional}`, and `list_sprints`
      `{project}` (id, name, dates, state, task counts) exist and pass through
      `can()` exactly as the REST sprint routes do.
- [ ] `set_task_sprint` `{task, sprint|null}`; `create_task` also accepts
      `sprint`.
- [ ] `update_task` `{task, title?, description_md?, acceptance_md?, priority?,
      due_date?, assignee?, sprint?, tags?}` - post-creation edits, same
      validation as the REST PATCH.
- [ ] `assign_task` `{task, user|null}` accepting user id or email (or the same
      folded into `update_task.assignee` - implementer's call, recorded in the
      task file); `create_task` accepts `assignee`; `list_members` `{project}`.
- [ ] `update_project_context` `{project, context_md, mode: replace|append}`.
- [ ] Agent guarantees hold: agents finish into `review`, never `done`;
      transition validation unchanged; every tool calls the service that calls
      `can()`.
- [ ] SPEC §7.1's tool table updated by CHIEF in the same landing (§4.4
      procedure - the count assertion in the drift tests will force it).

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
