---
id: LAI-1029
title: 'Retire `agent_other_owner` and `agent_wrong_org`: no server path answers them since LAI-1027'
area: server
assignee: chief
priority: p3
depends-on: [LAI-1027]
discovered-from: LAI-1027
status: review
started: 2026-11-01T23:35:00+05:30
finished: 2026-11-01T23:40:00+05:30
---

## Goal

LAI-1027 made a foreign agent (another member's, or another org's) answer
`agent_not_found` byte for byte (D-121 item 7). The two old reasons are still
listed in `SELECTED_AGENT_REFUSALS` (`server/src/services/work-requests.ts`)
only because `server/web/src/api/selected-agent.ts` mirrors that list exactly
and `server/web/test/api/selected-agent.test.ts` asserts the two are equal.
Nothing emits either one.

Two owners (§4.4): CORE drops them from the server constant and its
`MESSAGES`; SHELL drops them from the client mirror, `REFUSAL_WORDS` and the
picker's words. Neither half is green alone — the drift test refuses it.

## Acceptance criteria

- [x] Neither reason appears in `server/src/` or `server/web/src/`.
- [x] The web drift test still asserts the two lists are equal, and is green.

## Notes (chief, 2026-11-01)

- **Both halves in one branch** (§4.4 shape collapsed): the orchestrator
  dispatched one builder for the server and web halves together, so the drift
  test is never red at any commit. Named files only:
  `server/src/services/work-requests.ts` (CORE's half),
  `server/web/src/api/selected-agent.ts` and
  `server/web/test/api/selected-agent.test.ts` (SHELL's half).
- `depends-on: [LAI-1027]`: merged to `origin/master` (#181), task file still in
  `.tasks/review/`. Claimed on the orchestrator's direction; this is the
  deviation §2 step 1 asks to be recorded.
- **Copy fix, from the dispatch:** `REFUSAL_WORDS.agent_not_found` was *"That
  agent no longer exists."*, wrong for another member's agent, which answers
  the same reason. It is now *"That agent can’t be picked here. Pick one of
  your own agents."*, and `INELIGIBLE_SHORT.agent_not_found` is *"Not one of
  yours"* (unreachable: `ineligibleReason` never returns it, but the `Record`
  needs a value). A new test pins that the words name neither "gone" nor an
  owner.
- The drift test was mutation-checked: re-adding `'agent_wrong_org'` on the
  server side only turned *"every reason the server can send is in the list"*
  red (`# fail 1`). The file was restored and the restore confirmed.
- SPEC §6.4 already says the two reasons *"are no longer answered"*; still
  true, so it was left alone (no docs half authorised here).
