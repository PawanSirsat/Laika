---
id: LAI-561
title: 'endpoint-coverage goes red on LAI-534''s five /agents endpoints: name them in NO_BROWSER_CALLER until LAI-537 calls them'
area: web
assignee: shell
priority: p1
depends-on: [LAI-534]
discovered-from: LAI-534
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-27T21:00:12Z
finished: 2026-10-27T21:00:23Z
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

- [x] `endpoint-coverage.test.ts` is green with LAI-534 merged, and each new
      entry names LAI-537.
- [x] The stale-entry check removes them once LAI-537 calls the endpoints.
- [x] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Merge order

§4.4: CHIEF merges LAI-534 into local `master` unpushed; SHELL merges it,
lands this, pushes; nothing reaches `origin/master` red.

## Resolved by LAI-537 (SHELL, 2026-10-28)

**Resolved by LAI-537**, by the scope's second route: *"land LAI-537's client
calls first"*. `server/web/src/api/agents.ts` calls all five patterns with
literal paths: `/agents` (GET, POST), `/agents/${id}` (GET, PATCH),
`/agents/${id}/grants` (PUT), `/agents/${id}/rotate-token` (POST) and
`/agents/${id}/revoke` (POST). The Agents tab uses each one. **No
`NO_BROWSER_CALLER` entry was added**, so there is nothing for the stale-entry
check to remove.

- *AC 1:* `endpoint-coverage.test.ts` is green with LAI-534 merged. No entry
  names LAI-537 because none was needed: the endpoints are called.
- *AC 2:* nothing to expire, by construction.
- *Proved, not assumed:* with `src/api/agents.ts` removed, the check goes red
  with exactly the five paths quoted above; restored, it is green (checksums
  match).
- *AC 3:* the repo-root gate is LAI-537's, run on this branch (exit codes in
  LAI-537's log entry and PR).

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #111.
