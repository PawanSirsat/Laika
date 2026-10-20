---
id: LAI-792
title: 'An Omnigent-native primary session (polly) leaves no local signal, so the time a person types to it cannot be drafted'
area: cli
assignee: unclaimed
priority: p2
depends-on: [LAI-787]
discovered-from: LAI-787
status: backlog
---

## Goal

The time a person spends typing to Omnigent's own orchestrator reaches their
drafts, without Laika reading Omnigent's private database.

## What LAI-787 found

LAI-787 makes a primary **Claude Code** session count as the person's: the
hook compares `OMNIGENT_TERMINAL_LAUNCH_SESSION_ID` with
`OMNIGENT_RUNNER_PRIMARY_SESSION_ID` (verified in Omnigent's installed source:
`runner/_entry.py`, `host/connect.py`, `inner/terminal.py`). But the owner's
recent primaries — `polly` — are Omnigent's own agent: `chat.db` shows them as
kind 1 with no `external_session_id`, they write no `~/.claude` transcript and
run no Claude Code hook. Measured over 2026-10-14..20 the drafter found 7.3 h
for the owner, a floor well under the research's figure, largely for this
reason.

## Acceptance criteria

- [ ] A supported way for an orchestrator to tell the collector "the person
      typed now" — a hook Omnigent can call, or a documented event file —
      metadata only, never the text; or a decision that such time is entered
      by hand.
- [ ] Gate: test, lint, format exit 0.
