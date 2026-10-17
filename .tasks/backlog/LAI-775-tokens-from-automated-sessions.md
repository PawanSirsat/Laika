---
id: LAI-775
title: 'Decide whether tokens from automated sessions (Omnigent, CI) count as the developer''s'
area: docs
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-769
status: backlog
---

## Goal

D-080 item 7 keeps automated sessions out of the *prompt and session* counts:
the hook does nothing when `OMNIGENT=1`, `CI` or `LAIKA_ACTIVITY_SKIP` is set.
**Token usage cannot follow that rule.** It is read from the agents' own session
files, and a Claude Code transcript does not record the environment it was
started in, so an Omnigent-launched session's tokens are in the same files as
the developer's own and LAI-769 counts them all, under the developer.

On the owner's machine that is most of the tokens: the orchestrator's agents
run under the owner's account. Whether that is right — "tokens the team's
agents spent" — or wrong — "the developer's own work" — is an owner decision,
and D-084 does not make it.

## Acceptance criteria

- [ ] A decision entry (or an amendment to D-084) says whether automated
      sessions' tokens count, and if not, what marks a session as automated
      in its session file (a hook that records the session id from the hook
      payload when `OMNIGENT=1` is one way; D-084 item 1 keeps session ids local).
- [ ] If they are excluded, a task for the collector is filed.

## Notes / context

- LAI-769 says so in `cli/README.md` (*Every session's tokens count, automated
  ones too*) rather than leaving it implied.
