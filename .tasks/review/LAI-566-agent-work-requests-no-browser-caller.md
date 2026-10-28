---
id: LAI-566
title: 'endpoint-coverage goes red on GET /agents/me/work-requests: name it in NO_BROWSER_CALLER (agent tokens only, no browser caller ever)'
area: web
assignee: shell
priority: p1
depends-on: [LAI-535]
discovered-from: LAI-535
status: review
started: 2026-10-27T21:51:41Z
finished: 2026-10-27T22:15:24Z
---

Filed by CORE (Belka, dispatched by CHIEF) from CHIEF's block, 2026-10-28.

## Why

LAI-535 (CORE) serves `GET /api/v1/agents/me/work-requests` (SPEC §6.4): the
calling **agent's** open work requests. A session or a legacy token gets
`403 forbidden` with `reason: not_an_agent`, so the SPA has nothing to call it
with. The exemption is permanent, not "waiting on a screen". The list lives in
`server/web/`, so CORE did not reach across (CLAUDE.md §4.4).

This is not LAI-561. That task names LAI-534's five `/agents` paths and LAI-537.

The exact failing assertion (`server/web`, `endpoint-coverage.test.ts`,
`every served endpoint has a caller, or a named reason` › `no endpoint is
served, uncalled and unexplained`), as the repo-root gate printed it with
LAI-534 and LAI-535 in the tree:

```
+ [
+   'api/v1/agents',
+   'api/v1/agents/*',
+   'api/v1/agents/*/grants',
+   'api/v1/agents/*/revoke',
+   'api/v1/agents/*/rotate-token',
+   'api/v1/agents/me/work-requests'
+ ]
```

The last line is this task's. The other five are LAI-561's.

## Scope

- `server/web/test/api/endpoint-coverage.test.ts`: one `NO_BROWSER_CALLER`
  entry for `api/v1/agents/me/work-requests`, with this reason: *agent-token only, a session is
  `403 not_an_agent`; agents read it through MCP `list_ready_tasks`*.
- Nothing else.

## Acceptance criteria

- [x] `endpoint-coverage.test.ts` is green with LAI-535 merged, and the entry
      gives the reason above.
- [x] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Merge order

§4.4: rides with LAI-561 and LAI-538. CHIEF merges LAI-535 into local `master`
unpushed, then SHELL merges it, lands this and pushes. Nothing reaches
`origin/master` red.

## Notes

- **Claimed by SHELL (polly dispatch, Belka), 2026-10-28.** Worktree
  `Laika-agent-field`, branch `LAI-538-drawer-agent-field`, base `2b229e1e`:
  LAI-535 head `38ab6851` (draft PR #105, on #102, on #98/#96) with LAI-537
  (#104) and LAI-536 (#101) merged in. Must not merge before them.
- **Deviation, recorded as §2 asks:** the `depends-on` tasks are in
  `.tasks/review/`, not `done/`. CHIEF dispatched this against them, stacked.
- **D-114** approved in substance; authorised-account record pending, so the PR
  stays a draft.

## Submitted (SHELL, 2026-10-28)

- `server/web/test/api/endpoint-coverage.test.ts`: one `NO_BROWSER_CALLER`
  entry, `api/v1/agents/me/work-requests`, with the reason this file gives.
  Commit `e404f30b`, in LAI-538's branch and PR.
- LAI-561's five `/agents` paths were already called by LAI-537's
  `api/agents.ts` on this base, so `no endpoint is served, uncalled and
  unexplained` is green with this one entry.
