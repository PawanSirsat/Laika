---
id: LAI-814
title: 'Usage & cost has no per-space comparison: the organisation view never shows each space''s tokens and cost side by side'
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-769
status: backlog
---

## Goal

From the organisation view of Insights → Usage & cost, the owner can see how
many tokens each space consumed over the range, and what that cost, without
picking the spaces one at a time. The owner, 2026-10-20: *"we need to show how
much the project consume the token"*.

## Found (explore-project-token-usage, 2026-10-20, verified)

`GET /usage` has no full per-project total:
- `cache_by_project` counts only the input side and cache reads, with no
  output and no cost.
- `accepted.by_project` covers only tasks accepted in the range.
- `rework` counts only send-backs.
- `budgets` covers only the spaces that have one.

`?project=` works, but it is one call per space. A row's `project_id` is
copied from its resolved task (`server/src/db/schema.ts:1702-1705`), and an
unattributed row has `project_id = NULL`.

## Acceptance criteria

- [ ] **Server.** In the org view of `getUsage` (`server/src/services/token-usage.ts`,
      around `:1016`), add
      `by_project: { project: {slug,name}, tokens, cache_read, cost, share }[]`.
      - Compute it in one grouped query over `token_usage_days`, using the
        existing `token_usage_days_project_day_idx`.
      - Price it the way `totals.cost` is priced, caveats included.
      - Filter it to the spaces the reader may read (`usage.read_project`,
        the same rule as `cache_by_project` and `accepted`).
      - Sort by tokens, descending. In a space view it is `null`.
- [ ] **Outside any space.** One "outside any space" figure
      (`totals.tokens − Σ by_project`), so the rows add up to the org total.
      If the page already shows that remainder (`UsageScreen.tsx` around
      `:313`), reuse it; do not duplicate it.
- [ ] **Contract.** Update the `UsageView` type, the client type in
      `server/web/src/api/usage.ts`, and SPEC §6.4's `/usage` shape (a named
      SPEC edit, D-033). The client/server drift checks stay green.
- [ ] **Web.** Add a **By space** card on the org view (`usage.project === null`)
      using the existing `BarRows`. It shows each space's tokens, cost and
      share. A row links to that space's own Usage view (`?project=`). Light
      and dark, 1440 and 390.
- [ ] **No new exposure.** A project total is not a per-person figure, so it
      does not take `usage.read_people`. A reader sees only spaces they could
      already open with `?project=`. Tests cover an owner, an admin, and a
      member limited to their own spaces.
- [ ] **Tests fail without the feature.**
      - Two spaces plus unattributed rows give the right per-space numbers.
      - The rows plus the remainder equal `totals.tokens`.
      - A space the reader cannot read is absent.
      - Cost uses the same prices as the totals.
      - Prove one by mutation, confirming the mutation landed.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

Until LAI-815 (sub-agent tokens are dropped) and the attribution follow-up
land, `laika` will show close to 0 here. That is correct for the data the
board has. It is not a bug in this card.
