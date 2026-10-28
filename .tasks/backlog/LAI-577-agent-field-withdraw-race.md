---
id: LAI-577
title: 'agent-field withdraw race test fails on master CI and blocks the deploy: decide product race or test timing, and fix it'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-538
status: backlog
---

Filed by SHELL (Belka, dispatched by CHIEF), 2026-10-28. Board card LAIKA-830,
tag `p0`.

## Why

CI / Deploy run 40702908482, attempt 2, on `master` `fe49255c` (PR #106 merged
via #111) went red on one browser test, which blocked the production deploy:

```
server/web/test/browser/agent-field.test.ts:1263
'a withdraw confirmed after the read caught up to the earlier one still shows'
settledRow (agent-field.test.ts:1082) called from :1321
  'ag-laptop' !== ''      expected '' (no agent), actual 'ag-laptop'
server/web: 3554 pass / 1 fail
```

The same test passed in both #111 CI runs and locally, so it is intermittent.

## Scope

- Decide with evidence whether this is (a) a **product race**, where the drawer
  shows the old agent after a confirmed withdraw, or (b) a **test timing**
  problem, where the test asserts before the state settles or its fake
  responses arrive in an order the real app cannot produce.
- (a): fix the product, and keep or strengthen the test. (b): fix the test so
  it waits on the real settled state, without weakening what it proves.

## Acceptance criteria

- [ ] Root cause classified (a) or (b), with reproduction evidence recorded here.
- [ ] Breaking the fix on purpose turns the test red; the file is restored by checksum.
- [ ] `agent-field.test.ts` green 20+ runs in a row, including under CPU load.
- [ ] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
- [ ] PR into `master` opened (not draft); its CI run's conclusion reported.

## Role / machine

SHELL on Belka. Owner area: `web` (SHELL).

## Branch

`LAI-577-agent-field-withdraw-race`

## Rollout

Merging the PR deploys.
