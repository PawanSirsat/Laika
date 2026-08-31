---
id: LAI-429
title: 'The web half of the `blocked_by` rename'
area: web
assignee: shell
priority: p2
depends-on: [LAI-091]
discovered-from: LAI-099
status: review
started: 2026-08-31T23:04:58Z
finished: 2026-09-01T06:05:00Z
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

- [x] `TaskView.blocked_by`, and every read of it, renamed.
- [x] **Your branch is green alone.** The client type is its own declaration, so
      renaming it does not need the server's half to compile or to pass.
- [x] **If LAI-213's client/server drift check fails, stop and say so.** It is
      the test that binds the two halves and it will be red until CHIEF merges
      both. Do **not** exempt it, and do **not** disable it — an exemption that
      silences the one check this landing exists to satisfy is worse than a round
      trip (CLAUDE.md §4.4).
- [x] The UI still shows a blocked task as blocked, in both themes. A rename that
      compiles is not a rename that works — LAI-227's harness can click.
- [~] Full gate green — **except LAI-213's drift check, deliberately.** See below.

## Landing

Submit to `.tasks/review/` and stop. **CHIEF merges CORE's half first, locally
and unpushed**, then yours, then applies the `docs/` half, then pushes one green
state (§4.4 step 5). You never merge `master` mid-landing unless CHIEF says so.

## Notes

No new dependencies. No behaviour change of any kind — if a diff line does
anything other than rename, it is out of scope.

---

## Build note — SHELL, 2026-09-01

### **STOP HERE: LAI-213 is red, on purpose, and I have not touched it**

As AC3 requires. Both directions, which is the check doing exactly its job:

```
not ok - no server field is missing from its client type
    TaskView.dependencies is served and Task does not declare it
not ok - the client declares nothing the server does not send
    Task.blocked_by is declared and TaskView does not send it — it will be
    undefined at runtime
```

**Not exempted, not disabled, no `clientOmits` entry.** It goes green when
CORE's half lands beside mine. Everything else is clean: **561 of 563 passing,
0 type errors**, lint and format clean — the two failures are these.

### The count, and the three that are not this concept

**16 occurrences of `dependencies` in `src/`. 15 renamed, 1 left.**
`routes/screens/invite-roles.ts` — *"manage dependencies"* — is English
describing a permission, and stays.

`test/` held two more of the excluded kind, which the task did not mention
because it scoped the count to `src/` — and they are the other two categories
verbatim:

- `test/states.test.ts` — *"zero test dependencies"*, meaning **npm**.
- `test/api/use-board-filter.test.ts` — *"it must be in the dependencies"*,
  meaning a **React hook's array**.

Both left. The rename **asserts** all three still contain `dependencies` and
contain no `blocked_by`, so a future broad substitution cannot quietly take them.

37 renames in total: 15 in `src/`, 22 in fixtures and test names.

### Prose was rewritten, not substituted

A blunt replacement produced *"The blocked_by that are not done yet"* and
*"however many blocked_by it has"*. Those read as English again —
*"The entries in `blocked_by` that are not done yet"* — because a comment that
survives a rename mechanically is one nobody reads twice.

### AC4: a rename that compiles is not a rename that works

`blocked_by` feeds `blockedState` and `blockers`; a card that silently stopped
showing "blocked by" would typecheck perfectly. So there is a browser test on
LAI-227's harness: a task blocked by a second, unfinished task renders
`.card-blocked` **naming its blocker**, and the marker survives both themes
driven through the real theme control.

**Mutation-proven** — making `blockedState` never report blocked turns it red.

### Nothing else changed

No request body: the web client does not call `POST /tasks/:id/dependencies`,
checked rather than assumed. No behaviour change — every diff line is a rename,
or a comment made readable after one.
