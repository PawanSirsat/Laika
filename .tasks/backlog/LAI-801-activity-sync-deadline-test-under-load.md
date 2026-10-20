---
id: LAI-801
title: 'cli activity-sync "a sync that hangs is abandoned at its deadline" counts two failures under a loaded gate — a 300 ms wall-clock deadline (cli/)'
area: cli
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-788
status: backlog
---

## Goal

The root gate does not go red because the machine is busy.

## Acceptance criteria

- [ ] `cli/test/activity-sync.test.ts` "a sync that hangs is abandoned at its
      deadline, and writes nothing after" asserts the deadline path without
      depending on how fast a loaded machine answers a 300 ms deadline.
- [ ] Shown failing under load first (or by a slowed stub), then passing.
- [ ] Gate: test, lint, format exit 0.

## Notes / context

LAI-788's root `pnpm test` (all workspaces in parallel) exited 1 on this test
alone in `cli/`: `failures` was 2 where 1 was expected and `next_sync_at` one
backoff step later; the test took 2922 ms. The same file alone: 43/43 pass.
Neither `cli/src/activity-sync.ts` nor this test file changed on LAI-788. The
same class as LAI-768 (server tests under load), which covers `server/` only.

## Renumbered

Filed as `LAI-798` on branch `LAI-788-solidtime-bridge` (commit e1035a86),
the same day the polly-time builder filed its own `LAI-798` from LAI-792's
branch. That one was filed first and keeps the id; this one became
`LAI-801` at the merge (D-089). **Commits and LAI-788's log and task file
that say `LAI-798` for this task mean this file**, and are not rewritten (§4).
