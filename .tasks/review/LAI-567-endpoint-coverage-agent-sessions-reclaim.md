---
id: LAI-567
title: 'endpoint-coverage goes red on /agent-sessions and /tasks/:id/claim/reclaim: name them in NO_BROWSER_CALLER (agent tokens only)'
area: web
assignee: shell
priority: p1
depends-on: [LAI-541]
discovered-from: LAI-541
status: review
finished: 2026-10-28T10:26:38Z
started: 2026-10-27T23:20:09Z
---

Filed by CORE (Belka, dispatched by CHIEF) from CHIEF's block, 2026-10-28.

## Why

LAI-541 (CORE) serves four endpoints that only a **registered agent's token**
can call (SPEC §6.4, §9.1.1):

- `POST /api/v1/agent-sessions`
- `POST /api/v1/agent-sessions/:id/heartbeat`
- `POST /api/v1/agent-sessions/:id/end`
- `POST /api/v1/tasks/:id/claim/reclaim`

A session or a legacy token gets `403 forbidden` with `reason: not_an_agent`,
so the SPA has nothing to call them with. This is a permanent exemption, not
one waiting on a screen. The list lives in `server/web/`, so CORE did not
reach across (CLAUDE.md §4.4).

This is not LAI-561 or LAI-566. Those two name the `/agents` paths.

The exact failing assertion (`server/web`, `endpoint-coverage.test.ts`,
`every served endpoint has a caller, or a named reason` ›
`no endpoint is served, uncalled and unexplained`), as the repo-root gate
printed it with LAI-534, LAI-535 and LAI-541 in the tree:

```
+ [
+   'api/v1/agent-sessions',
+   'api/v1/agent-sessions/*/end',
+   'api/v1/agent-sessions/*/heartbeat',
+   'api/v1/agents',
+   'api/v1/agents/*',
+   'api/v1/agents/*/grants',
+   'api/v1/agents/*/revoke',
+   'api/v1/agents/*/rotate-token',
+   'api/v1/agents/me/work-requests',
+   'api/v1/tasks/*/claim/reclaim'
+ ]
```

This task covers the three `agent-sessions` lines and the `claim/reclaim`
line. The `/agents` lines belong to LAI-561 and LAI-566.

## Scope

- `server/web/test/api/endpoint-coverage.test.ts`: `NO_BROWSER_CALLER`
  entries for the four paths above, with this reason: *agent-token only, a
  session is `403 not_an_agent`; the local helper (LAI-542) and MCP
  `start_working` call them*.
- Nothing else.

## Acceptance criteria

- [x] `endpoint-coverage.test.ts` is green with LAI-541 merged, and each entry
      gives the reason above.
- [x] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Merge order

CLAUDE.md §4.4: this rides with LAI-543 (the verb mirror for
`task.claim_expired` and `task.claim_reclaimed`), LAI-566 and LAI-561. CHIEF
merges LAI-541 into local `master` and does not push it; SHELL lands this on
top and pushes. Nothing reaches `origin/master` red.

## Notes

- Claimed 2026-10-27T23:20:09Z by SHELL (dispatched by polly on Belka). Worktree
  `Laika-exec-states`, branch `LAI-543-execution-states`, base `6bab5f7d` =
  LAI-541 head `3e17cfad` (draft PR #107) with LAI-538 (#106, on #105/#104/#101)
  merged. Stacked; must not merge before #107 and #106. D-114 approved in
  substance, record pending -> draft PR.
- **Deviation recorded:** `depends-on` LAI-541 and LAI-538 are in review, not
  done; the stack is the dispatcher's instruction. LAI-543 and LAI-567 ride
  together (§4.4 client half of the LAI-541 verbs and endpoints).

## Delivered (SHELL, 2026-10-28)

`server/web/test/api/endpoint-coverage.test.ts`: four `NO_BROWSER_CALLER`
entries — `api/v1/agent-sessions`, `api/v1/agent-sessions/*/heartbeat`,
`api/v1/agent-sessions/*/end`, `api/v1/tasks/*/claim/reclaim` — each with
*"agent-token only, a session is `403 not_an_agent`; the local helper
(LAI-542) and MCP `start_working` call it"*. Checked against LAI-541 round 2:
`reclaimTask` calls `requireAgent` before any scope check, so a session is
`not_an_agent` there too. No browser caller was added: none of the four is a
person's act. The `/agents` lines were already named by LAI-566 and LAI-561 on
this stack. Gate: see LAI-543 and `logs/shell-2026-10-28.md`.
