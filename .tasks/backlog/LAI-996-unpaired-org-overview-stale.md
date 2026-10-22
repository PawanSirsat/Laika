---
id: LAI-996
title: 'OrgOverviewView is paired now: drop it from the server census UNPAIRED list'
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-989]
discovered-from: LAI-989
status: backlog
---

LAI-989 pairs `OrgOverviewView` with the web client's `OrgOverview` in
`server/web/test/api/view-type-drift.test.ts`. The server's census then
reports the `UNPAIRED` entry as stale. This is the §4.4 two-owner case:
the entry is in CORE's file, so SHELL does not take it.

Red with LAI-989's branch, green at its base `63690059` (the test exits 0
there):

```
FAIL test/tooling/response-type-coverage.test.ts > every served response type is paired or named > names nothing that is already paired or no longer served
+   "OrgOverviewView is paired now — remove it from UNPAIRED",
FAIL … > reports how much of the surface is actually guarded
AssertionError: expected 87 to be 86
```

## Acceptance criteria

- [ ] `server/test/tooling/response-type-coverage.test.ts`: the
      `['OrgOverviewView', 'no client type exists']` entry in `UNPAIRED` is
      removed. That is the only edit.
- [ ] `npx vitest run test/tooling/response-type-coverage.test.ts` in
      `server/` exits 0 once merged with LAI-989.
