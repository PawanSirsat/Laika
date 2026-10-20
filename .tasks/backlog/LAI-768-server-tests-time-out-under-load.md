---
id: LAI-768
title: 'Server tests hit the 5-second vitest timeout under load (migrate, build boot, MCP parity) and turn a whole gate red (server/)'
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-765
status: backlog
---

## Goal

The server suite gives the same answer on a busy machine as on an idle one,
so a local gate or a slow GitHub runner never goes red for a timeout in a test
whose code nobody touched. Filed by CHIEF (Omnigent) on the owner's direct
instruction.

## Acceptance criteria

- [ ] The tests that timed out on 17 Oct under load average about 20 pass
      reliably under the same load:
      `server/test/db/migrate.test.ts` (for example "keeps the ratings and
      refuses a replace of one", "0031 adds the heatmap…"),
      `server/test/tooling/build.test.ts` ("boots, migrates, serves health",
      "built server never became healthy"),
      `server/test/mcp/parity.test.ts` ("create_task — identical activity…"),
      `server/test/tooling/environment-posture.test.ts` (60 s setup hook).
- [ ] The fix makes the slow work cheaper or gives those specific tests an
      explicit, documented budget; it does not raise the global timeout and
      does not loosen any assertion.
- [ ] Proof: the root `pnpm test` exits 0 three times in a row with every CPU
      core busy (one `yes` per core, killed by PID afterwards).

## Notes / context

Seen by the LAI-756, LAI-758, LAI-760 and LAI-765 builders: each failing test
passes when run alone. The browser-test equivalent was LAI-765.

## Raised to p1, proof narrowed (CHIEF, 2026-10-20, before any claim)

**It now reddens GitHub too.** CI / Deploy run 39405262872 on `958b0a19`
failed on `build.test.ts` "keeps an idle connection open for 65 s, and says so
(LAI-722)": *built server never became healthy on port 34931*, thrown at
`waitForHealth` (`build.test.ts:559`, 100 tries × 100 ms). In the same week,
locally, the other cases failing through that same helper were "shuts down
promptly with an SSE stream open (LAI-057)" and "serves the committed
fallback". So did migrate.test.ts's "keeps the ratings and refuses a replace
of one" (8.4 s). Three of the last 15 master runs failed this way, and a
failed run deploys nothing.

**Proof criterion, replaced.** The original asked for three full root runs
with every core pinned. This Mac has had two thermal emergencies today, so
that proof is not worth the risk to it. Instead:
- Each named file passes **five times in a row** under one `yes` per core,
  with the `yes` processes killed by PID afterwards and the kill confirmed.
- **One** root `pnpm test` exits 0 under the machine's normal load.
- The builder **first reproduces the failure** under that load on today's
  code, so the fix is shown to change the outcome.
