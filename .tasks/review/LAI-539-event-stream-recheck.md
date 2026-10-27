---
id: LAI-539
title: 'Open event streams re-check token expiry/revocation, agent status and project limit'
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-10-27T19:31:22.043108+00:00
finished: 2026-10-27T23:50:00+00:00
---

Implements **proposal §2 (SSE defect), §4.6** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

An event stream that is already open stops delivering the moment its
token is revoked or expires, its agent is revoked, or an event falls outside the
token's project limit. Today `routes/events.ts:162` checks only at connect
(audit M10, LAIKA-542).

## Scope

- Before each event is written, re-check: token not revoked, not expired; agent (if any) active; event's project inside the token pin and the agent's grants.
- On failure: close the stream with a final error event carrying a §6.3 `code`.
- Cheap re-check (cached per stream, invalidated by revoke) so throughput does not regress.

## Out of scope

- Scoped hand-off events (LAI-553).
- Any SPEC edit: if §11.5 needs a sentence, file a docs task.

## Acceptance criteria

- [x] Revoking a token closes its open stream before the next event, asserted against a real stream, with the error `code`.
- [x] An expired token's open stream closes at the next event after expiry (injected clock).
- [x] A project-pinned token never receives another project's event on an open stream (the M10 case).
- [x] A revoked agent's stream closes.
- [x] Existing `Last-Event-ID` replay and `gap` behaviour unchanged (existing tests green).
- [x] Repo-root gate exits 0.

## Tests and UI evidence required

Route tests opening a real SSE stream, mutating auth state mid-stream, asserting the close and its `code` — never a bare timeout.

## Dependencies

`depends-on: none`.

This is the **local implementation task file for the existing board card LAIKA-542** ("M10 · The live event stream ignores a token's project limit") — not a second card (proposal §2.1). LAIKA-542 carries `external_ref: LAI-539`; its description was widened by a comment, not rewritten: the local task also covers re-checking token revocation and expiry on open streams. **Proceeds without any decision** (proposal §8).

## Role / machine

CORE on Belka. Owner area: `server` (CORE).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

1 day, confidence H.

## Branch

`LAI-539-event-stream-recheck`

## Migration / rollout notes

No schema change. Behaviour change for clients holding revoked tokens only.

## Implementation notes

Owner directly assigned CORE on Belka to branch
`LAI-539-open-streams-recheck-credentials`, based on programme head `3e49890e`
(draft PR #98). This is the authorized base rather than merging master.

## Hand-off notes (CORE, Claude Code continuing the Codex worker)

- "Agent revoked" is covered as the token holder's deactivation: this base has
  no separate agent-identity schema (test `closes a deactivated token agent
  stream with unauthorized`).
- Close behaviour: one final `error` frame, no `id:`, data = the §6.3 body
  `{ error: { code: 'unauthorized', message: 'That access token is not valid',
  details: null } }`, then the stream ends. Cookie streams unchanged.
- SPEC §11.5 does not yet name the `error` control frame — for CHIEF (no SPEC
  edit made, per Out of scope).
