---
id: LAI-554
title: 'Local event helper: receive, dedupe, present bounded notices at hook boundaries'
area: cli
assignee: shell
priority: p1
depends-on: [LAI-553, LAI-542]
discovered-from:
status: in-progress
started: 2026-10-31T12:17:25Z
---

Implements **proposal §4.6, §5** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

An agent learns about a hand-off or context change at its next tool or
prompt boundary through a short notice, acknowledged back to Laika as received
and presented.

## Scope

- Helper holds the SSE connection, dedupes, stores pending notices.
- Hook adapters inject at most 300 characters at the next boundary (Claude Code, Codex).
- Acks `received` and `presented`.

## Out of scope

- Other harnesses (LAI-557)

## Acceptance criteria

- [ ] A notice is never longer than 300 characters (asserted).
- [ ] A duplicate event produces one notice.
- [ ] Notices are rendered as data in an untrusted block.
- [ ] Repo-root gate exits 0.

## Tests and UI evidence required

Node tests with a real server stream.

## Dependencies

`depends-on: [LAI-553, LAI-542]`.

## Role / machine

SHELL on Belka. Owner area: `cli` (SHELL).

## Priority

P1 — board priority `p1`.

## Effort

2 days, confidence M.

## Branch

`LAI-554-event-helper`

## Migration / rollout notes

Opt-in per harness.
