---
id: LAI-805
title: 'An Omnigent Claude Code primary''s replies to Omnigent''s own notices still draft time'
area: cli
assignee: unclaimed
priority: p2
depends-on: [LAI-792]
discovered-from: LAI-792
status: backlog
---

## Goal

A night of sub-agent wake-ups in an Omnigent **Claude Code** primary drafts
no time, as LAI-792 makes true for an Omnigent-native orchestrator.

## What LAI-792 found

Omnigent 0.17.0 posts its `[System: sub-agent … finished …]`, timer and
idle-terminal notices to every parent except a codex-native one
(`runner/app.py` `_schedule_subagent_wake`), and the claude-native harness
types the latest user message into the Claude terminal
(`inner/claude_native_executor.py` → `inject_user_message`, a tmux paste). So
a Claude Code primary (LAI-787's path) receives each notice as a prompt.
LAI-792 (D-090) stops the hook writing `p claude-code` for those. But the
drafter's lane for that session is built from **the replies in its
transcript**, and Claude Code answers each notice with replies like any other
turn; those still chain into drafted minutes overnight.

## Acceptance criteria

- [ ] The replies of a Claude Code primary's turn that began with Omnigent's
      notice draft no time, by a rule D-090 allows (only a yes or no derived
      from the prompt, never kept) — or a decision recorded why not.
- [ ] A test: a primary's night of notices, each answered, drafts nothing; a
      turn the person typed among them still drafts.
- [ ] Gate: test, lint, format exit 0.
