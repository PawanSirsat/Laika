---
id: LAI-775
title: 'Decide whether tokens from automated sessions (Omnigent, CI) count as the developer''s'
area: docs
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-769
status: done
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

## Decision (2026-10-17, the owner, through CHIEF)

**Tokens from Omnigent-launched sessions do not count as the developer's** —
nor CI's, nor any session run with `LAIKA_ACTIVITY_SKIP`. Past sessions cannot
be told apart, and that is said rather than guessed at.

## Done, in LAI-769 (review round 1)

- `plugin/scripts/laika-activity-hook` — with `OMNIGENT=1`, a non-empty `CI` or
  `LAIKA_ACTIVITY_SKIP`, the hook still counts nothing; from the
  **session-start and session-end payloads only** (never a prompt's) it keeps a
  `"session_id"` that is a plain id (letters, digits, `.`, `_`, `-`, ≤ 128) and
  appends `<epoch> <id>` to `~/.laika/activity/skip-sessions` (0600, never
  sent). Under zsh, builtins only. Nothing when activity is not on.
- `cli/src/activity-usage.ts` — every kept record carries its session (Claude
  Code's `sessionId`, which subagent files share with their parent; Codex's
  `session_meta` id; Gemini's `sessionId`), and a record whose session is in
  the skip file is left out. A session marked after its tokens were sent is
  taken out at the next sync (the day is re-sent, and replaces).
- `laika activity on` and `backfill` say before they ask that sessions from
  before activity was on cannot be told apart; `cli/README.md`,
  `plugin/README.md` and SPEC §6.4 say so too.
- Tests: `cli/test/activity-hook.test.ts` (ids kept for all three markers,
  never from a prompt, never anything but a plain id, nothing with activity
  off, builtins only under zsh) and `cli/test/activity-usage.test.ts` (Claude
  incl. subagents, Codex, Gemini left out; a late mark taken back out).

What is left is the first criterion's entry in `docs/DECISIONS.md` (or an
amendment to D-084), which is CHIEF's to write; the collector work the second
criterion asks for is the list above. CHIEF moves this task.

## Accepted

2026-10-17: accepted by CHIEF (Omnigent). Decided by the owner through CHIEF and built inside LAI-769's review round; recorded as D-086.
