---
id: LAI-1031
title: 'The watcher-role test waits for its reads; the Playwright cache key refuses an empty version'
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-1030
status: in-progress
started: 2026-11-01T19:26:17Z
---

Owner batch, 2026-11-01 (polly dispatch). Two small follow-ups, one PR.

## Goal

1. `server/web/test/browser/task-panel.test.ts` — *"a watcher's role is
   named, and it comes from the members"* failed on CI run 41320486784 (web
   shard 1/4) and earlier on `master`. Find the real race and wait on the
   settled state; never weaken the assertion.
2. `.github/workflows/deploy.yml` — the *Playwright version* step must fail
   when the detected version is empty, so a broken probe cannot share a stale
   `playwright-Linux-` cache key. Nothing else in the workflow.

Named files, one by one (the scope this task grants):
`server/web/test/browser/task-panel.test.ts`, `.github/workflows/deploy.yml`.

## Acceptance criteria

- [ ] The test waits for the `/watchers` and `/members` data to settle, never
      on the asserted Viewer clause; no assertion weakened or removed.
- [ ] Mutation: the viewer role check broken in `TaskMeta.tsx` → this test
      red on the Viewer assertion.
- [ ] Delayed reproduction: `/members` and `/watchers` held 1.5 s → the old
      body red, the new body green.
- [ ] The *Playwright version* step exits non-zero on an empty version;
      nothing else in `deploy.yml` changes.
- [ ] CI green on the PR.
