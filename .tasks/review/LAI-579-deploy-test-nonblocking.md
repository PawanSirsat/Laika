---
id: LAI-579
title: Temporarily let a red Test step proceed to the master deploy
area: chief/ops
assignee: chief
priority: p0
depends-on: []
discovered-from: LAI-532
status: review
finished: 2026-10-28T19:54:18Z
started: 2026-10-28T19:08:03Z
---

## Goal

On Pawan's direct instruction in chat, 2026-10-29, temporarily allow a failing
Test step to proceed to production only for pushes to master. Keep every test
case and keep running the full suite. Tests still block pull requests,
integration-* pushes and workflow_dispatch. Lint and Format block everywhere.

## Acceptance criteria

- [x] Only the Test step gains conditional continue-on-error for a push to refs/heads/master; its full pnpm test command remains.
- [x] Test has an id; a final gate step checks its raw failure outcome and emits a GitHub warning that it was not allowed to block deploy, naming LAI-579 and the temporary exception.
- [x] A one-line YAML comment names LAI-579 and says "temporary, owner instruction 2026-10-29; revert when the flaky tests are fixed".
- [x] Triggers, timeouts, Lint, Format, build, deploy needs/if and rollback are unchanged.
- [x] A second backlog task tracks restoring blocking tests, depends on LAI-577 (the LAI-538 withdraw-race fix) and LAI-576, and both board cards carry external_ref.
- [x] YAML parses; actionlint runs if installed; pnpm lint and pnpm format each run separately with their own log and exit code.
- [x] Branch is pushed and a non-draft PR targets master; the PR's CI conclusion and head SHA are reported without merging or pushing master.

## Notes / context

Allowed files: `.github/workflows/deploy.yml`, this task file, and the requested
restore task file. No application or test changes. No dependencies added.
The explicit owner scope confines the work record to these task files.

Owner's temporary exception supersedes the normal blocking test gate for master
pushes only. Risk accepted in that instruction: a red test no longer stops a
production deploy. Local pnpm test is unaffected by this workflow-only change;
the PR's CI still runs it in full and a failure remains blocking there.

CHIEF on Belka; branch `LAI-579-deploy-test-nonblocking`, created in a temporary
worktree from origin/master. Do not merge, force-push or push master.

Board priority is p1 with tag p0 because the live schema has no p0 priority.

Restore task: LAI-580 (`.tasks/backlog/LAI-580-restore-blocking-deploy-test.md`).
Board cards created via MCP: LAIKA-832 (external_ref LAI-579) and LAIKA-833
(external_ref LAI-580). The restore card has both blocker relationships.

## Verification / submission

- Python yaml.safe_load parsed `.github/workflows/deploy.yml`, exit 0. A parsed
  comparison with origin/master removed only the added Test id,
  continue-on-error and final warning and found the remainder identical.
- `actionlint` is not installed; skipped as allowed.
- `pnpm lint > /tmp/LAI-579-lint.log 2>&1`: exit 0 (repo-wide ESLint).
- `pnpm format > /tmp/LAI-579-format.log 2>&1`: exit 0 (repo-wide configured file glob).
- Local `pnpm test` is unaffected by this workflow-only change and was not
  rerun. All cases remain; PR CI runs the full blocking Test step.

PR: https://github.com/PawanSirsat/Laika/pull/118 (non-draft, base master).
First PR CI: https://github.com/PawanSirsat/Laika/actions/runs/40752067926,
head `068f10bbda2e5d7202db072730ea9ce9aac6da49`, conclusion **success**.
Lint, Format and Test passed; Build and Deploy were skipped. The CI conclusion
and head SHA were reported in chat before submitting this task for review.

This submission changes task metadata only. CI for its resulting final head
will also be awaited and its conclusion attached to the PR and board evidence.
The unmerged temporary worktree is retained under CLAUDE.md §4.2.

- `pnpm --filter @laika/server exec vitest run test/tooling/task-file-state.test.ts > /tmp/LAI-579-task-state.log 2>&1`: exit 0 after moving to review; file set `server/test/tooling/task-file-state.test.ts`.
- `python3 -c 'import yaml; yaml.safe_load(open(".github/workflows/deploy.yml"))'`: exit 0; file set `.github/workflows/deploy.yml`.
