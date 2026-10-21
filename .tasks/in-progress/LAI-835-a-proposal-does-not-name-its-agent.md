---
id: LAI-835
title: 'An agent''s proposed time does not say which agent proposed it'
area: server
assignee: chief
priority: p3
depends-on: []
discovered-from: LAI-831
status: in-progress
started: 2026-10-21T11:52:24Z
---

## Goal

The owner's My day design (LAI-831) says "Proposed by claude-code" in the
inspector and shows a `claude-code` badge on the row. LAI-831 says "Proposed
by an agent" and `agent`, because nothing serves the name.

## Found (LAI-831's census)

`propose_time_entry` and `POST /me/time-drafts` store `source: 'agent'` and
nothing about the token that sent it (`time_drafts` has no column for it), so
the person cannot tell one agent's proposal from another's.

## Acceptance criteria

- [ ] A proposal keeps the proposing token's client name, as tokens already
      record a client (`created_by_client`-style), never free text from the
      agent.
- [ ] `GET /me/time` serves it on the draft, to the person alone.
- [ ] My day shows it in the inspector and on the row's badge.
- [ ] Tests fail on today's code; the gate exits 0.

## Built (the builder, 2026-10-21)

On the owner's direct instruction (*"do it what is needs to do"*), the last of
the three pieces LAI-831 left out of the owner's My day design. Branch
`LAI-835-proposal-names-its-agent`, **built on LAI-833**
(`LAI-833-agents-lane`). That branch adds migration `0046`, and this one's is
`0047`, chained after it.
The merge order is LAI-822 (#5), LAI-859 (#7), LAI-834 (#8), LAI-833, then
this.

- **Kept as a finished round keeps it** (D-076, §4.25). A proposal copies the
  proposing token's `last_client_name`, D-076's name from `initialize`, cleaned
  and slugged. For an agent that never sends `initialize`, it copies the
  token's own name, which the Connect screen sets. It is a **copy**, so a token
  that later connects as another agent does not rename an old proposal. It is
  **never** taken from anything the proposal says (`note` included), and a
  collector's block has none (`server/src/services/time-drafts.ts`,
  `proposeTimeDraft`).
- **Column:** `time_drafts.client_name`, nullable. Migration
  `0047_time_draft_client_name.sql`, a single `ALTER TABLE … ADD`, generated
  by `pnpm --filter @laika/server run db:generate --name
  time_draft_client_name`.
- **Served** on each draft as `client` in `GET /me/time`: the person's own, on
  a web session, like every draft.
- **My day:**
  - the row's badge says the agent (`claude-code`), not `agent`;
  - the inspector says *"Proposed by claude-code"*, not *"Proposed by an
    agent"*;
  - `evidenceLine` says *"Proposed by claude-code"*.

  A board that predates this sends no `client`, and the old words stay
  (`TimeDraft.client` is optional on the client).
- **SPEC** §4.47 gains the `client_name` row, and §7.1's `propose_time_entry`
  row now names the agent.

## Verification

Every command was run from the worktree root. The counts are collected test
cases.

**Fail first** (the source reverted under a `trap`, then restored and checked):

| what | command | on today's code |
| --- | --- | --- |
| server | `pnpm --filter @laika/server exec vitest run test/services/time-draft-client.test.ts` | exit 1, 5 of 5 failed |
| browser | `pnpm --filter @laika/web exec node --test test/browser/my-day-proposal-client.test.ts` | exit 1, *"the row and the inspector name the agent"* failed; *"a board that does not say keeps the old words"* passed on both, as the regression guard it is |

**After:**

| command | exit | collected |
| --- | --- | --- |
| server: `vitest run test/tooling/ test/services/time-drafts.test.ts test/services/time-draft-client.test.ts test/services/my-day.test.ts test/http/routes/time.test.ts test/http/routes/time-my-day-v2.test.ts test/db/ test/mcp/` | 0 | 38 files, 886 passed |
| web: `node --test 'test/routes/screens/my-day/*.test.ts' 'test/api/*.test.ts' 'test/theme/*.test.ts'` | 0 | 831 passed |
| web: `node --test test/browser/my-day-proposal-client.test.ts` | 0 | 2 passed |
| web: `node --test` on `my-day-v2`, `my-day`, `my-day-bulk`, `my-day-signals`, `my-day-agents` browser files | 0 | 62 passed |
| `npx tsc --noEmit` in `server/` and `server/web/` | 0, 0 | — |
| `pnpm exec eslint` on the nine changed files | 0 | — |

The root gate's exit codes are recorded below once it has run.
