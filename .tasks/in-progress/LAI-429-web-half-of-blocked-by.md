---
id: LAI-429
title: 'The web half of the `blocked_by` rename'
area: web
assignee: shell
priority: p2
depends-on: [LAI-091]
discovered-from: LAI-099
status: in-progress
started: 2026-08-31T23:04:58Z
---

## Goal

`TaskView.dependencies` becomes **`blocked_by`** (LAI-099, D-044). This is the
`server/web/` half of a **§4.4 three-owner landing**. CORE takes `server/src` and
`server/test`; CHIEF takes `docs/`; you take this.

**Read LAI-099 first** — it carries the scope ruling, including the three
surfaces that are deliberately *not* renamed.

## What changes

Sixteen occurrences in `server/web/src`, several of them prose:

- `api/tasks.ts` — the `TaskView` field declaration, and the comment on `blocks`
  that describes itself as *"the reverse edge of `dependencies`"*
- `api/board-derive.ts` — readiness and the blocking-task lookup
- `routes/screens/board/TaskCard.tsx`, `TaskDetailPanel.tsx`, `ListView.tsx`
- `routes/screens/dashboard/dashboard-derive.ts`

## What does not

- **A React hook's `dependencies` array is not this concept.** Neither is an npm
  dependency. Do not rename either, and do not count them.
- `routes/screens/invite-roles.ts` says members can *"manage dependencies"* — that
  is English describing a permission, not a field name. Leave it.
- The **request body** does not change here: the web client does not call
  `POST /tasks/:id/dependencies` today. If you find that it does, stop — the
  parameter is `blocked_by_task_id` in CORE's half and the two must land together.

## Acceptance criteria

- [ ] `TaskView.blocked_by`, and every read of it, renamed.
- [ ] **Your branch is green alone.** The client type is its own declaration, so
      renaming it does not need the server's half to compile or to pass.
- [ ] **If LAI-213's client/server drift check fails, stop and say so.** It is
      the test that binds the two halves and it will be red until CHIEF merges
      both. Do **not** exempt it, and do **not** disable it — an exemption that
      silences the one check this landing exists to satisfy is worse than a round
      trip (CLAUDE.md §4.4).
- [ ] The UI still shows a blocked task as blocked, in both themes. A rename that
      compiles is not a rename that works — LAI-227's harness can click.
- [ ] Full gate green.

## Landing

Submit to `.tasks/review/` and stop. **CHIEF merges CORE's half first, locally
and unpushed**, then yours, then applies the `docs/` half, then pushes one green
state (§4.4 step 5). You never merge `master` mid-landing unless CHIEF says so.

## Notes

No new dependencies. No behaviour change of any kind — if a diff line does
anything other than rename, it is out of scope.
