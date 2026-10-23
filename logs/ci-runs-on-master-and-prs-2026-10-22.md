## 2026-10-22T17:56:00Z — LAI-990 (built on Belka, dispatched by CHIEF)

**What changed**
- .github/workflows/deploy.yml — `on:` narrowed to push to `master` and
  `integration-*`, `pull_request` into `master` and `integration-*`, and
  `workflow_dispatch`; concurrency keeps `production` (never cancelled) for a
  master push and gives everything else a `ci-<PR number or ref>` group that
  cancels in progress; `build` and `deploy` `if:` now also require
  `github.event_name == 'push'`; header comment states what runs where
- .tasks/review/LAI-990-ci-runs-on-master-and-prs.md — claimed, finished,
  builder notes

**Decisions**
- The deploy `if:` checks the event as well as the ref, not the ref alone — a
  pull request's ref is `refs/pull/N/merge` today, so the old check would hold,
  but the job should not depend on that to stay out of production.
- `workflow_dispatch` on master no longer deploys — the criterion says deploys
  run only for a push; the old ref-only `if:` let a manual dispatch release.
  A re-run of a master push still deploys because it keeps its `push` event.
- Validation by Psych (Ruby's built-in YAML) plus a throwaway node script that
  evaluates the expressions for six events, rather than downloading
  `actionlint` — the task allows a parse check, and an unpinned binary from
  the network is not worth it for one file.

**Discovered**
- `server/web/test/routes/screens/timeline/timeline-derive.test.ts:287`'s
  600 ms backstop failed at 603.8 ms with load average ~60; the re-run passed.
  → logged to the board as unlisted work (not filed as a task: outside this
  task's file scope).
- CLAUDE.md §4's *"Branches other than `master` run the gate and deploy
  nothing."* is now wrong → reported to CHIEF for rewording.
- Psych reads the bare `on:` key as YAML 1.1 `true`; any future script that
  parses `deploy.yml` must look under `true` as well as `on`.

**State**
In review; PR open against master, not merged.
