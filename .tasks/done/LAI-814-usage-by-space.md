---
id: LAI-814
title: 'Usage & cost has no per-space comparison: the organisation view never shows each space''s tokens and cost side by side'
area: server
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-769
status: done
started: 2026-10-20T12:14:07Z
finished: 2026-10-20T18:36:05Z
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
- [x] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

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
- **Gate.** Round 0 left it unticked: the root gate was forbidden at dispatch,
  so every affected file was run alone instead (list in the log). **Round 1
  ran it once, on `161a1559` with a clean tree**: `pnpm test` 0 (web
  2336/2336; cli 530 pass, 2 skipped; server 3287 pass, 10 skipped, 159 files
  + 2 skipped), `pnpm lint` 0, `pnpm format` 0 — each to its own file, its own
  exit code.

**Filed: LAI-825** (round 1, from review). `?project=` on `/insights` makes the
shell treat that space as open, as on Members and Meeting review: the sidebar
marks it current beside Insights, and the shell reads its name and sprint count
and opens its event stream.

## Review round 1 (2026-10-20) — BLOCK, fixed

**The blocker.** A By space row for an **archived** space did not open it. The
server rightly counts archived spaces in `by_project` (so the rows add up), but
`GET /projects` sends one as a tombstone (`http/routes/projects.ts:148`),
`isProject` drops it from the screen's space list, and `scopeFor` fell back to
All spaces: the row added `?project=old`, the page stayed on the organisation,
the selector said All spaces and the sidebar marked the archived space open.

**The fix (the reviewer's decision).** A row links **only** to a space the
selector offers — `offeredSpaces()` and `spaceRow()` in `usage-derive.ts`. Any
other is still counted, named in plain text with a small muted **archived**
marker. With no space list (the read failed), no row links and none is marked,
since nothing is known to be archived. Commit `fix(web): an archived space's By
space row is named, not linked`.

**Tests that fail on the round-1 code:** `browser/usage.test.ts` *an archived
space is counted but not a link …* — run before the fix it failed `expected: 0,
actual: 1` on the archived row's link count, the defect itself;
`usage-derive.test.ts` *a By space row is a link only to a space the selector
offers* — failed before the fix (no such export). Screenshots of the archived
row: `/tmp/laika-usage-shots/usage-by-space-archived-{light,dark}-{1440,390}-card.png`.

**(a) Outside the named files — for CHIEF to accept consciously.**
`server/web/src/components/shell/ScreenOutlet.tsx` (`UsageRoute`) is not named
by this task and is the shell's, not the Usage screen's. It now passes
`?project=` to `UsageScreen` and writes the selector's choice back
(`setParams`, replace). Without it the AC's *a row links to that space's own
Usage view (`?project=`)* could not work: route params reach a screen only
there, and the screen's space was React state. No other file outside the named
ones and the `routes/screens/usage/` folder changed; `BySpaceCard.tsx` is new
in that folder.

**(c) *Tied to no task* has an edge.** `token_usage_days.task_id` and
`project_id` are both `ON DELETE SET NULL`. A **hard-deleted task** leaves its
rows with no task but still in their space: they stay in that space's
`by_project` figure while the *Unattributed* tile counts them as tied to no
task, so the tile and *Outside any space* can differ. A **hard-deleted space**
takes its tasks with it (`tasks.project_id` cascades), so its rows keep neither
and fall into *Outside any space*, whose note says *tied to no task* although
they once were tied. No service hard-deletes a task or a space today —
archiving is the only removal — so both need a manual or future delete.

## Accepted (CHIEF, 2026-10-21)

Review round 1 (review-usage-by-space) blocked on one defect: an archived
space's By space row linked to `?project=<slug>`, which falls back to All
spaces. Fixed in `3ff89dc2`: a row links only to a space the selector offers;
any other is named in plain text with an "archived" marker; with no space
list nothing links. CHIEF read the fix (`offeredSpaces`, `spaceRow`) and the
new browser test that failed on the defect. The ScreenOutlet change outside
the named files is accepted knowingly (it is what makes the row link open the
space's own view). The sidebar side effect is filed as LAI-825.
