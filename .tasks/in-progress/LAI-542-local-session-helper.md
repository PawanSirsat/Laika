---
id: LAI-542
title: 'Local helper: laika agent session start|heartbeat|end bound to the harness PID; Claude Code + Codex hook adapters'
area: cli
assignee: shell
priority: p1
depends-on: [LAI-541]
discovered-from:
status: in-progress
started: 2026-10-27T23:19:45Z
---

Implements **proposal §4.7, §5** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

Claude Code and Codex sessions open, renew and close a Laika agent
session automatically, and renewal stops the moment the harness process that
holds the session dies — even if the helper survives.

## Scope

- `laika agent session start|heartbeat|end` in `cli/`.
- Heartbeat checks the harness PID is alive before renewing.
- Adapters: Claude Code (`SessionStart`, `PostToolUse`, `UserPromptSubmit`, `SessionEnd`) and Codex (same, `SessionEnd` advisory) in `plugin/` / `cli/`.
- Credential from the agent's token via the harness's documented mechanism (proposal §5).

## Out of scope

- Checkpoints (LAI-547)
- Other harnesses (LAI-557)
- Notices (LAI-554)

## Acceptance criteria

- [ ] Killing the harness process stops renewals within one heartbeat interval while the helper stays alive (asserted with a real child process).
- [ ] `end` closes the session with an `end_reason`.
- [ ] Network failure retries without creating a second session.
- [ ] The token never appears in hook output, logs or argv (asserted).
- [ ] Repo-root gate exits 0, and the `cli/` workspace has a test that fails if the command is absent.

## Tests and UI evidence required

Node tests against a real server on your own port; a spawned fake harness process killed mid-session.

## Dependencies

`depends-on: [LAI-541]`.

## Role / machine

SHELL on Belka. Owner area: `cli` (SHELL).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

2 days, confidence M.

## Branch

`LAI-542-session-helper`

## Migration / rollout notes

Opt-in: the adapter is installed per harness. Existing hooks unchanged.

## Notes (SHELL, claim)

- Base: LAI-541 head `3e17cfad` (draft PR #107, stacked on #105 → #102 →
  #98/#96). Branch `LAI-542-agent-session-helper` (the task file says
  `LAI-542-session-helper`; the orchestrator named the branch, kept as given).
- **Deviation recorded:** `depends-on: [LAI-541]` is in `.tasks/review/`, not
  `done/`. Claimed on CHIEF's (polly's) direction; this work must not merge
  before #107. D-114 approved in substance, record pending → the PR is a draft.
