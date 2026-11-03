---
id: LAI-1039
title: 'Launcher: decide and, if allowed, start a harness for a work request'
area: cli
assignee: shell/belka
priority: p3
depends-on: [LAI-558]
discovered-from: LAI-558
status: in-progress
started: 2026-11-03T14:35:00+05:30
---

## Goal

LAI-558's launcher refuses work requests (`work_request_not_launched` in the
audit log): a work request carries no checkpoint, so there is no `handoff
prepare` to make the isolated, verified worktree D-117 requires before anything
starts.

## Needs first

An owner decision on what a work request's worktree is — e.g. a fresh worktree
from the remote default branch's current head, on a `LAI-NNN-…` branch — since
that is new git logic outside D-117's text. Then the harness claims with
`start_working` through the normal path, exactly as it accepts an offer now.

## Acceptance criteria

- [ ] Recorded as an amendment to D-117 before any code.
- [ ] Same limits, audit, argv/env/stdin rules as LAI-558; tests and mutations.
- [ ] Repo-root gate exits 0.

## Dispatch (2026-11-03, CHIEF / polly)

Built as **slice B** of `.polly/plans/auto-pickup-capacity.md` (§8 "B — CLI
launcher and service"), fixing F1–F6, together with LAI-1038's CLI half
(presence report and the capacity-ping answer). The amendment the first
criterion asks for is **D-117a** (with D-126 and D-127), written by CHIEF in
PR #251.

**Dependency deviation, recorded as §2 step 1 requires.** `depends-on`
names LAI-558. It — with LAI-553, LAI-554 and LAI-1041, which this builds on
too — is accepted by CHIEF in PR #251 and still in `.tasks/review/` on
`origin/master` while that PR is open. CHIEF's dispatch says so by name:
*"its deps LAI-553/554/558/1041 are accepted in #251"*. This branch is cut
from `origin/master` and does not carry #251's commits.

Named files (the plan's list, nothing else): `cli/src/agent-launcher.ts`,
`cli/src/agent-events.ts`, `cli/src/agent-handoff.ts` (exports only),
`cli/README.md` (launcher section); new `cli/src/agent-workspace.ts`,
`cli/src/agent-launcher-service.ts`, `cli/src/agent-capacity.ts`,
`cli/src/agent-omnigent.ts`; tests `cli/test/agent-launcher.test.ts`,
`agent-events.test.ts`, new `agent-workspace.test.ts`,
`agent-launcher-service.test.ts`, `agent-omnigent.test.ts`,
`agent-launcher-e2e.test.ts`, and `cli/test/support/fake-harness.ts`.

