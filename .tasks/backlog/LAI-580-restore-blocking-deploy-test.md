---
id: LAI-580
title: Restore the blocking Test step in deploy.yml
area: ops
assignee: unclaimed
priority: p0
depends-on: [LAI-576, LAI-577, LAI-578]
discovered-from: LAI-579
status: backlog
---

## Goal

Restore the blocking Test step for master deploys after the flaky tests are
fixed. Pawan's 2026-10-29 instruction temporarily allows a red Test step only
on master pushes (LAI-579); this task tracks removing that exception.

## Acceptance criteria

- [ ] LAI-576 (the merged setTheme session-swap fix), LAI-577 (the LAI-538 agent-field withdraw-race fix), and LAI-578 (the setTheme follow-up, PR #117, discovered from LAI-576) are accepted and integrated on master; verify stability before restoring the gate.
- [ ] Remove the Test step's conditional continue-on-error, the temporary owner-instruction comment and the final non-blocking-test warning from `.github/workflows/deploy.yml`.
- [ ] The full pnpm test step still runs; a red Test step blocks master deploys, pull requests, integration-* pushes and workflow_dispatch.
- [ ] Lint and Format remain blocking; triggers, timeouts, build, deploy needs/if and rollback stay unchanged.
- [ ] YAML parses, actionlint runs if available, and pnpm test, pnpm lint and pnpm format each exit 0 with separate logs and exit codes; open a PR into master and report CI.

## Notes / context

Allowed change: `.github/workflows/deploy.yml` and this task file.
No test cases may be deleted or skipped. The temporary bypass is a production
risk: any failing test, including a real regression, no longer stops a master
deploy. The live board represents p0 as priority p1 plus tag p0.
