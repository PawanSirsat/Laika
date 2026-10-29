---
id: LAI-588
title: 'The agent session helper sends harness, harness_version and model on session start and heartbeat'
area: cli
assignee: strelka
priority: p1
depends-on: [LAI-586]
discovered-from: LAI-532
status: review
started: 2026-10-29T09:46:40Z
finished: 2026-10-29T09:58:27Z
---

D-118 (proposed, `docs/proposals/LAI-532-agent-identity-model.md`, PR #121):
*"Each session records what actually ran, self-reported and labelled as such:
the underlying harness (e.g. Codex), its version, and the model."* LAI-586 makes
`POST /agent-sessions` and `POST /agent-sessions/:id/heartbeat` accept
`harness`, `harness_version` and `model`.

## Acceptance criteria

- [x] The CLI's agent session helper (LAI-542) sends `harness`, `harness_version` and `model` when it opens a session, when it can tell them
- [x] It sends `model` again on heartbeat when it changes mid-session
- [x] Nothing it cannot tell is guessed — an unknown field is omitted, not sent empty
- [x] Tests for what the helper sends, asserting the request body
- [x] The lost-claim notice (`cli/src/agent-session.ts`, around line 787) tells a `released` claim (do not reclaim — since LAI-586 a claim the selection does not back ends `released`, and its holder may never reclaim it) from an `expired` one (reclaim with `start_working` `reclaim: true`); today it suggests reclaim for both

## Notes

**Dependency deviation (CLAUDE.md §2 step 1).** `depends-on: [LAI-586]`, and
LAI-586's task file is still in `.tasks/review/`. Belka's hand-off on LAIKA-842
directs starting against LAI-586's merged server half (PR #123, in
`origin/master` at `b5c232ea`), so this was built against that code.

**What the server accepts, quoted** (`server/src/http/routes/agent-sessions.ts`,
`SELF_REPORTED`): `StartBody` and `HeartbeatBody` are both
`strictObject({ client_version?, harness?, harness_version?, model? })`;
`harness` is `/^[a-z0-9][a-z0-9._-]*$/`, `harness_version` 1–64 of
`/^[\x21-\x7e]+$/`, `model` 1–120 of `/^[\x20-\x7e]+$/`. A heartbeat field
omitted keeps what the session last said.

**What is sent, and when** (`cli/src/agent-session.ts`):

- Start: `harness` always (`claude-code` / `codex`, named by the hook), plus
  `harness_version` and `model` only when read; nothing unknown is sent.
- Heartbeat: only the fields that differ from what the board was last told
  (a `/model` switch, or a version first read after the start); no body
  otherwise. Marked told only after a `200`, so a lost beat resends.
- A retried keyed start resends exactly the body bound to its key
  (`start_body`), because the idempotency store answers a key reused with a
  different body `409`; anything learned since goes on the first heartbeat.

**How each field is detected** (`readSelfReport`), read 2026-10-29 from real
transcripts of both harnesses on this machine:

| | `harness_version` | `model` |
| --- | --- | --- |
| Claude Code | `version` on the newest transcript line | the hook input's `model`, else the newest `assistant` line's `message.model` (`<synthetic>` skipped) |
| Codex | `session_meta.payload.cli_version` (first line, ~22 KB in a real rollout) | the hook input's `model`, else the newest `turn_context.payload.model` |

At most 256 KB from each end of the transcript, a regular file only (a FIFO
would block). Values outside the server's shapes are omitted.

**Released vs expired** (`lostNotice`). `reclaimTask` in
`server/src/services/claims.ts` refuses anything but the agent's own newest
claim in `expired` (`409 nothing_to_reclaim`), and since LAI-586 a claim the
selection does not back ends `released`. The notice now offers
`start_working` with `reclaim: true` only when an `expired` claim is among the
lost, and says *"A released or transferred claim is over: do not reclaim it;
the board refuses that reclaim."* when a non-expired one is.

