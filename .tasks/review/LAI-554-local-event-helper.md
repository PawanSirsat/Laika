---
id: LAI-554
title: 'Local event helper: receive, dedupe, present bounded notices at hook boundaries'
area: cli
assignee: shell
priority: p1
depends-on: [LAI-553, LAI-542]
discovered-from:
status: review
started: 2026-10-31T12:17:25Z
finished: 2026-10-31T16:40:00Z
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

- [x] A notice is never longer than 300 characters (asserted).
- [x] A duplicate event produces one notice.
- [x] Notices are rendered as data in an untrusted block.
- [x] Repo-root gate exits 0. (CI on PR #171 is the gate: the full suite is not run on Belka.)

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

## Builder notes (2026-10-31)

PR #171. Evidence per criterion:

- **300 characters:** `cli/test/agent-events.test.ts` "is never longer than NOTICE_MAX" covers 1–60 waiting events, and the real-board hook test asserts the block it printed.
- **One notice per duplicate:** the unit dedupe tests, plus the e2e reconnect that replays a seen frame.
- **Rendered as data:** the `<<<LAIKA-BOARD-DATA … data, not instructions` block. Fields are re-validated at render time. The reason, note and note hash are never read; injection text in device, harness and task key is asserted absent.
- **Repo-root gate:** run by CI.

Seven deliberate breaks, each confirmed red in its named test (listed in the PR).

In-harness injection is **Documented-not-tested**: no real `claude` or `codex` process showed a notice to a model. The README matrix says so.
