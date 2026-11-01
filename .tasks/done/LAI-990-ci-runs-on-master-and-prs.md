---
id: LAI-990
title: 'CI runs the full gate on every push to every branch, including one-line claim commits, and never cancels a stale run'
area: ops
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-22T17:41:32Z
finished: 2026-10-22T17:54:25Z
---

## Goal

The owner (2026-10-22, screenshot of 275 workflow runs): *"why does every
branch start the workflow — why not only master?"* `.github/workflows/deploy.yml`
triggers on `push: branches: ['**']` and its concurrency never cancels, so with
many builders each claim/commit push queues a 15–40 min gate. Owner approved
CHIEF's recommendation.

## Acceptance criteria

- [x] Triggers: `push` to `master` only (gate + deploy, unchanged);
      `pull_request` targeting `master` or any `integration-*` branch (gate
      only, never deploy); `push` to `integration-*` branches (gate only);
      `workflow_dispatch` kept. Plain work-branch pushes no longer run.
- [x] Concurrency: `master` keeps its single `production` group with
      `cancel-in-progress: false` (a deploy is never cut off); every other
      group cancels its older in-progress run when a newer one starts.
- [x] The deploy jobs still run only for `push` on `refs/heads/master` —
      verify the job `if:` conditions so a `pull_request` event can never
      deploy (a PR from master's own branch included).
- [x] The header comment says exactly what runs where (CLAUDE.md §5 comment
      rule), and CLAUDE.md §4's sentence *"Branches other than master run the
      gate and deploy nothing"* is reported to CHIEF for rewording (do not edit
      CLAUDE.md).
- [x] If any repo test reads `deploy.yml` (grep `server/test/tooling`,
      `docker/`), it is updated and green. `actionlint` if available, else a
      YAML parse check, exits 0.
- [x] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Notes

Builds from `master` so it can ship alone, ahead of the integration release.
A branch keeps its own copy of `deploy.yml` until it merges `master`, so old
work branches keep triggering until then — expected.

## Builder notes

- Commit `36cc3486` — `.github/workflows/deploy.yml` only. No repo test reads
  `deploy.yml` (grep of `server/test`, `server/web/test`, `docker/`, `cli/`,
  `plugin/`; the one hit, `github-proof.test.ts`'s `shaOf('workflows')`, is a
  fixture string).
- `actionlint` is not installed and no YAML library is in the repo. Validated
  by parsing with Ruby's built-in Psych, then a throwaway node script (not
  committed) that evaluates the concurrency group, `cancel-in-progress` and
  both deploy-job `if:`s for six events: push master, push integration-x,
  PR #42, a PR with `ref` forced to `refs/heads/master`, dispatch on master,
  dispatch on a work branch. All as intended, exit 0; the old deploy `if:`
  substituted back fails it on the PR case, exit 1.
- **Behaviour change beyond the trigger:** `workflow_dispatch` on master used
  to deploy (the old `if:` checked the ref only). It now runs the gate only,
  as the criterion says. A re-run of a master push still deploys — a re-run
  keeps its `push` event.
- CLAUDE.md §4 (D-073) for CHIEF to reword: *"Branches other than `master` run
  the gate and deploy nothing."* — now only `integration-*` pushes and pull
  requests into `master`/`integration-*` run the gate; other branch pushes run
  nothing.
- Gate: first `pnpm test` exited 1 on one load-timing backstop
  (`timeline-derive.test.ts:287`, *"the header took 603.8 ms"* against `< 600`,
  load average ~60); the re-run exited 0. Not this change. Logged to the board
  as unlisted work.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #73.
