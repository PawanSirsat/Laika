---
id: LAI-814
title: 'Usage & cost has no per-space comparison: the organisation view never shows each space''s tokens and cost side by side'
area: server
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-769
status: review
started: 2026-10-20T12:14:07Z
finished: 2026-10-20T12:47:04Z
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

- [x] **Server.** In the org view of `getUsage` (`server/src/services/token-usage.ts`,
      around `:1016`), add
      `by_project: { project: {slug,name}, tokens, cache_read, cost, share }[]`.
      - Compute it in one grouped query over `token_usage_days`, using the
        existing `token_usage_days_project_day_idx`.
      - Price it the way `totals.cost` is priced, caveats included.
      - Filter it to the spaces the reader may read (`usage.read_project`,
        the same rule as `cache_by_project` and `accepted`).
      - Sort by tokens, descending. In a space view it is `null`.
- [x] **Outside any space.** One "outside any space" figure
      (`totals.tokens − Σ by_project`), so the rows add up to the org total.
      If the page already shows that remainder (`UsageScreen.tsx` around
      `:313`), reuse it; do not duplicate it.
- [x] **Contract.** Update the `UsageView` type, the client type in
      `server/web/src/api/usage.ts`, and SPEC §6.4's `/usage` shape (a named
      SPEC edit, D-033). The client/server drift checks stay green.
- [x] **Web.** Add a **By space** card on the org view (`usage.project === null`)
      using the existing `BarRows`. It shows each space's tokens, cost and
      share. A row links to that space's own Usage view (`?project=`). Light
      and dark, 1440 and 390.
- [x] **No new exposure.** A project total is not a per-person figure, so it
      does not take `usage.read_people`. A reader sees only spaces they could
      already open with `?project=`. Tests cover an owner, an admin, and a
      member limited to their own spaces.
- [x] **Tests fail without the feature.**
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

## Builder notes (usage-by-space, 2026-10-20)

Commits: `feat(server): GET /usage by_project, and a By space card on Usage &
cost`, `docs(spec): §6.4 lists by_project[].cost among GET /usage's costs`.
Full record in `logs/usage-by-space-2026-10-20.md`.

**Per criterion.**

- **Server.** `by_project` in `getUsage`'s org view (`null` in a space).
  `projectModels()` is one grouped query (project × model) over
  `token_usage_days_project_day_idx`, now shared with `cache_by_project`
  rather than a second read of the same range. Priced with `loadPriceBook`'s
  book through `priced()`, as `totals.cost` is, so unpriced and inferred
  models travel with each space. Filtered by the same `scope` list
  (`usage.read_project`) as `cache_by_project` and `accepted`. Sorted by tokens
  descending, then name. A space with no rows in the range is absent, as in
  `cache_by_project`.
- **Outside any space.** `outsideAnySpace()` (`api/usage.ts`) is
  `totals − Σ by_project`, shown as By space's last row so the rows add up.
  The `:313` stat is the **space** view's tile and is not drawn on the
  organisation, so it could not be reused as the org remainder; its name is
  now the one constant `OUTSIDE_ANY_SPACE` both use. No second tile was added.
  The row carries no cost: a subtracted cost cannot carry the unpriced caveats.
- **Contract.** `UsageView`/`UsageProjectTotal` on the server, `Usage`/
  `UsageProjectTotal` on the client, paired in `view-type-drift.test.ts`;
  SPEC §6.4's `/usage` shape and cost list. The drift check is green, and red
  when the client drops `UsageProjectTotal.share` (mutation below).
- **Web.** `BySpaceCard.tsx` on the org view with `BarRows`: tokens, share,
  cost; each space links to `/insights?tab=usage&project=<slug>`. **One file
  outside the names above was needed**: `components/shell/ScreenOutlet.tsx`'s
  `UsageRoute` now passes `?project=` in and writes it back, because the
  screen's space was React state and a `?project=` link would otherwise have
  opened All spaces. Screenshots light and dark, 1440 and 390:
  `/tmp/laika-usage-shots/usage-by-space-{light,dark}-{1440,390}-{page,card}.png`;
  the themes browser test now measures 1440 too.
- **No new exposure.** No `usage.read_people` anywhere on the path. Tests: an
  owner and an admin who is in no space (the private space included); a
  member, refused the organisation (`forbidden`) and given `null` in their
  space; and a token pinned to one space, which sees only that one and is
  refused another with `?project=`.
- **Tests fail without the feature.** Exact numbers throughout. Mutations, each
  confirmed by checksum and restored by checksum: drop cache writes from a
  space's tokens (4 red); price with the built-in table rather than the org's
  book (price test red, 0.067 vs 0.031); remove the readable-space filter
  (pinned-token test red); client type without `share` (drift red);
  `outsideAnySpace` not subtracting (2 red); `?project=` not passed to the
  screen (both new browser tests red).
- **Gate — not ticked.** `pnpm lint` 0 and `pnpm format` 0. **`pnpm test` was
  not run**: the task was dispatched with the root gate forbidden (the machine
  was hot and another builder was gating; polly gates on master after the
  merge). Instead every affected file was run alone, each exit 0 — the list
  and counts are in the log.

**Seen, not filed.** `?project=` on `/insights` makes the shell treat that
space as open, as on Members and Meeting review: the sidebar marks it current
beside Insights, and the shell reads its name and sprint count and opens its
event stream.
