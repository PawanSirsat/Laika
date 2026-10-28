---
id: LAI-561
title: 'endpoint-coverage goes red on LAI-534''s five /agents endpoints: name them in NO_BROWSER_CALLER until LAI-537 calls them'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-534]
discovered-from: LAI-534
status: backlog
---

Filed by CORE (Belka, dispatched by CHIEF) from CHIEF's block, 2026-10-28.

## Why

LAI-534 (CORE) serves `/api/v1/agents` (SPEC §6.4, D-114). No SPA code calls
it yet — that is LAI-537, the Agents tab — so `server/web/test/api/endpoint-coverage.test.ts`
goes red the moment LAI-534's branch is in the tree. The exemption list lives
in `server/web/`, so per CLAUDE.md §4.4 CORE did not reach across.

The exact failing assertion (`node --test test/api/endpoint-coverage.test.ts`,
`every served endpoint has a caller, or a named reason` › `no endpoint is
served, uncalled and unexplained`):

```
served with no caller and no entry in NO_BROWSER_CALLER — build it, or say why not
+ [
+   'api/v1/agents',
+   'api/v1/agents/*',
+   'api/v1/agents/*/grants',
+   'api/v1/agents/*/revoke',
+   'api/v1/agents/*/rotate-token'
+ ]
- []
```

## Scope

- `server/web/test/api/endpoint-coverage.test.ts`: five `NO_BROWSER_CALLER`
  entries, each naming LAI-537 (*"built, served, and waiting on a screen"*),
  or close this by landing LAI-537's client calls first.
- Nothing else.

## Acceptance criteria

- [ ] `endpoint-coverage.test.ts` is green with LAI-534 merged, and each new
      entry names LAI-537.
- [ ] The stale-entry check removes them once LAI-537 calls the endpoints.
- [ ] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Merge order

§4.4: CHIEF merges LAI-534 into local `master` unpushed; SHELL merges it,
lands this, pushes; nothing reaches `origin/master` red.
