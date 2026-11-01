---
id: LAI-1039
title: 'Launcher: decide and, if allowed, start a harness for a work request'
area: cli
assignee: unclaimed
priority: p3
depends-on: [LAI-558]
discovered-from: LAI-558
status: backlog
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
