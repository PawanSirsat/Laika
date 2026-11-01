---
id: LAI-1029
title: 'Retire `agent_other_owner` and `agent_wrong_org`: no server path answers them since LAI-1027'
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-1027]
discovered-from: LAI-1027
status: backlog
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

- [ ] Neither reason appears in `server/src/` or `server/web/src/`.
- [ ] The web drift test still asserts the two lists are equal, and is green.
