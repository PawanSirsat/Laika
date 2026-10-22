---
id: LAI-990
title: 'CI runs the full gate on every push to every branch, including one-line claim commits, and never cancels a stale run'
area: ops
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-22T17:41:32Z
---

## Goal

The owner (2026-10-22, screenshot of 275 workflow runs): *"why does every
branch start the workflow — why not only master?"* `.github/workflows/deploy.yml`
triggers on `push: branches: ['**']` and its concurrency never cancels, so with
many builders each claim/commit push queues a 15–40 min gate. Owner approved
CHIEF's recommendation.

## Acceptance criteria

- [ ] Triggers: `push` to `master` only (gate + deploy, unchanged);
      `pull_request` targeting `master` or any `integration-*` branch (gate
      only, never deploy); `push` to `integration-*` branches (gate only);
      `workflow_dispatch` kept. Plain work-branch pushes no longer run.
- [ ] Concurrency: `master` keeps its single `production` group with
      `cancel-in-progress: false` (a deploy is never cut off); every other
      group cancels its older in-progress run when a newer one starts.
- [ ] The deploy jobs still run only for `push` on `refs/heads/master` —
      verify the job `if:` conditions so a `pull_request` event can never
      deploy (a PR from master's own branch included).
- [ ] The header comment says exactly what runs where (CLAUDE.md §5 comment
      rule), and CLAUDE.md §4's sentence *"Branches other than master run the
      gate and deploy nothing"* is reported to CHIEF for rewording (do not edit
      CLAUDE.md).
- [ ] If any repo test reads `deploy.yml` (grep `server/test/tooling`,
      `docker/`), it is updated and green. `actionlint` if available, else a
      YAML parse check, exits 0.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Notes

Builds from `master` so it can ship alone, ahead of the integration release.
A branch keeps its own copy of `deploy.yml` until it merges `master`, so old
work branches keep triggering until then — expected.
