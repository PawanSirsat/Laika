---
id: LAI-798
title: 'An Omnigent orchestrator''s drafted minutes are never tied to a task'
area: cli
assignee: unclaimed
priority: p3
depends-on: [LAI-792]
discovered-from: LAI-792
status: backlog
---

## Goal

When the person works through an Omnigent orchestrator (polly), its drafted
minutes take a task key the way a Claude Code session's do, so fewer of them
land as "no task" for the person to assign by hand.

## What LAI-792 found

LAI-792 drafts the orchestrator's turns as a lane of their own, with no
repository and no task: the hook records only `t`/`r omnigent <epoch>
<session>`, and the drafter ties a session's untied minutes to a task only
through a commit in **that session's repository**. Replayed over the owner's
2026-10-20 (34 polly turns, 00:22–10:51), the draft grew from 6 minutes to
3 h 43 min, of which only the 5 minutes already tied stayed tied: every
orchestrator minute was "no task", while 72 of the owner's own commits fell in
the same hours. The orchestrator's workspace is `OMNIGENT_RUNNER_WORKSPACE`;
its sub-agents commit in worktrees of that repository.

## Acceptance criteria

- [ ] An orchestrator's lane knows its workspace's repository (local only,
      never sent) and its untied minutes take a commit's key by the existing
      rule — or a decision recorded why not.
- [ ] Whether the orchestrator's workspace joins `repos` (which also decides
      which repositories the heatmap counts commits in, D-079 scope) is decided
      and said in the task, not assumed.
- [ ] Gate: test, lint, format exit 0.
