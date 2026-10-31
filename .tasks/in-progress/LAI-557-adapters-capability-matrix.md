---
id: LAI-557
title: 'Adapters + capability matrix: Cursor, Copilot (CLI/IDE/cloud), Gemini CLI, Antigravity'
area: cli
assignee: shell
priority: p2
depends-on: [LAI-554]
discovered-from:
status: in-progress
started: 2026-10-31T15:05:00+02:00
---

Implements **proposal §5** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

The remaining harnesses get adapters for session, checkpoint and
notice, and a capability matrix records what each one can do on a real version.

## Scope

- Adapters for Cursor (IDE/CLI), Copilot (CLI, VS Code, cloud), Gemini CLI, Antigravity.
- Matrix at `cli/agent-adapters/CAPABILITIES.md`, each cell Certified / Documented-not-tested / Unsupported with the version.

## Out of scope

- Editing proposal §5 (CHIEF updates it after review).

## Acceptance criteria

- [ ] Each harness has an install test that fails if its adapter is absent.
- [ ] Harnesses that cannot inject at a prompt (Cursor, Copilot) deliver at the next tool boundary, documented.
- [ ] Not-installed harnesses stay Documented-not-tested, never marked certified.
- [ ] Repo-root gate exits 0.

## Tests and UI evidence required

Node tests per adapter; manual runs for installed harnesses recorded in the matrix.

## Dependencies

`depends-on: [LAI-554]`.

**Deviation (recorded at claim, 2026-10-31):** LAI-554 is still in
`.tasks/backlog/`. The polly manager (CHIEF, Belka) dispatched this task
anyway, as Phase 5 of LAI-532. Nothing here needs LAI-554's notice
helper: where a harness has no injecting hook, delivery is the explicit
`laika agent inbox` / `checkpoint` / `handoff` commands, and the
next-tool-boundary notice is wired to the shared hook engine only where
that engine already speaks the harness's documented hook shape.

## Role / machine

SHELL on Belka. Owner area: `cli` (SHELL).

## Priority

P2 — board priority `p2`.

## Effort

3–4 days, confidence L.

## Branch

`LAI-557-more-adapters`

## Migration / rollout notes

Opt-in per harness.
