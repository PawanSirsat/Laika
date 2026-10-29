---
id: LAI-588
title: 'The agent session helper sends harness, harness_version and model on session start and heartbeat'
area: cli
assignee: strelka
priority: p1
depends-on: [LAI-586]
discovered-from: LAI-532
status: in-progress
started: 2026-10-29T09:46:40Z
---

D-118 (proposed, `docs/proposals/LAI-532-agent-identity-model.md`, PR #121):
*"Each session records what actually ran, self-reported and labelled as such:
the underlying harness (e.g. Codex), its version, and the model."* LAI-586 makes
`POST /agent-sessions` and `POST /agent-sessions/:id/heartbeat` accept
`harness`, `harness_version` and `model`.

## Acceptance criteria

- [ ] The CLI's agent session helper (LAI-542) sends `harness`, `harness_version` and `model` when it opens a session, when it can tell them
- [ ] It sends `model` again on heartbeat when it changes mid-session
- [ ] Nothing it cannot tell is guessed — an unknown field is omitted, not sent empty
- [ ] Tests for what the helper sends, asserting the request body
- [ ] The lost-claim notice (`cli/src/agent-session.ts`, around line 787) tells a `released` claim (do not reclaim — since LAI-586 a claim the selection does not back ends `released`, and its holder may never reclaim it) from an `expired` one (reclaim with `start_working` `reclaim: true`); today it suggests reclaim for both
