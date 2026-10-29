---
id: LAI-318
title: 'AgentReadiness says "No token yet." for an agent whose every token expired or was revoked'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-565
status: backlog
---

Filed by Strelka while building LAI-565, 2026-10-29.

## Why

LAI-565 put LAI-536's `AgentReadiness` on the Agents tab's rows. An active
agent whose every token has expired or been revoked (`agentState` →
`no-credential`) reads as *credential created — not yet*, and
`READINESS_WORDS.credential_created.notYet` in
`server/web/src/components/agent/agent-states.ts` says **"No token yet."** That
is false for such an agent: it had a token, and the word *yet* says it is on its
way to one. The pill it replaced said *No live credential*. The row's
*Credential: None live* fact still says the true thing beside it.

## Scope

- `server/web/src/components/agent/agent-states.ts` (`READINESS_WORDS`) and,
  if it needs a fourth input, `AgentReadiness.tsx` — so a credential that
  existed and stopped working is told apart from one never created.
- Nothing server-side.

## Acceptance criteria

- [ ] An agent whose every token is expired or revoked never reads *No token
      yet*; the words say its credential no longer works.
- [ ] An agent never given a token still reads as not yet created.
- [ ] Both are asserted, each against the other's fixture.
- [ ] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
