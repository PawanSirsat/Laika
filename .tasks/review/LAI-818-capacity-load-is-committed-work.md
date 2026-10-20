---
id: LAI-818
title: 'Capacity calls everyone Heavy: load counts review and backlog, overdue triggers it, the badge ignores the selected space, and board activity counts bookkeeping'
area: server
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-796
status: review
started: 2026-10-20T13:00:21Z
finished: 2026-10-20T19:16:00Z
---

## Goal

Capacity's load badge and counts reflect committed work (D-092 item 3), so
"Heavy" means something. **D-092 is the contract.**

## Found (audit-metrics-sense, 2026-10-20, production)

- **`loadOf`** (`server/src/services/presence.ts:446-451`) returns heavy if
  in progress is over 5, **or** anything is overdue, **or** open is over 15.
  Open includes backlog and review.
- **In review is counted as the assignee's load** (`presence.ts:474-475`):
  Pawan 77, Ashutosh 163 (Sauce 123 plus OnRoute 40, median wait 19 days).
- **"To do" includes backlog** (`presence.ts:476`, `CapacityCard.tsx:175`):
  Pawan's 257 is 209 backlog plus 47 to do.
- **The space chips** count backlog and review too (`presence.ts:707-722`).
  Laika's 254 drops to 28 committed. Every Laika card is assigned to the owner
  by convention.
- **The badge reads the global load** (`CapacityCard.tsx:114`) while the counts
  read the selected space (`:66`). The "Heavy load" chip
  (`capacity-derive.ts:96-97`) does the same.
- **"Board activity · 2714"** (`db/activity.ts:95-114`, `presence.ts:812-818`):
  2,547 of Pawan's 2,717 are agent rows, mostly bookkeeping (680 created,
  656 sprint moves, 546 edits and reorders). The rollup already stores
  `by_self` and `by_agents`.
- **The "Waiting for review" tile** is capped at 200 (`review.ts:30,129`). The
  real total is 242.
- **Team load** (`capacity-derive.ts:250-258`) uses the same open-work rule.

## Acceptance criteria

- [x] **Server load.** Load is in progress plus to do. The thresholds apply
      to that number, with the values stated in SPEC §11.4.2.1 or wherever
      Capacity is specified (a named edit). Overdue no longer makes a person
      Heavy; the payload carries it as its own field.
- [x] **Counts.** Each card shows **in progress · to do · backlog** apart, and
      **waiting for review** apart, labelled as waiting on reviewers. Space
      chips use committed work, with backlog available on hover or as a
      second figure.
- [x] **Per-space badge.** With a space selected, the badge and the "Heavy
      load" filter use that space's load. The server sends it, or the web
      applies the same rule to the per-space counts; say which.
- [x] **Activity.** Board activity shows work done by the person apart from
      work done by their agents, for example "14 days · 170 by you · 2,547 by
      agents". Bookkeeping verbs (sprint moves, reorders) are excluded from
      the figure, or shown apart; say which.
- [x] **Review total.** The tile shows the true total from the server, or
      "200+" when capped. Do not raise the cap.
- [x] **Contract.** The client and server types stay in step, with drift
      checks green.
- [x] **Tests.** They fail on today's code:
      - a person with 0 in progress, 0 to do and 100 in review is not Heavy;
      - overdue alone is not Heavy;
      - the per-space badge;
      - the activity split.
      Prove two by mutation.
- [x] **Screenshots.** Before and after, light and dark, 1440 and 390, in
      `/tmp/laika-capacity-shots/`.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Builder notes (owner-direct, capacity-load builder, 2026-10-21)

**Named cross-area edits** (D-033/D-034): `docs/SPEC.md` **§9.3** (the
Capacity bullets: `workload`, `load`, `activity_14d_split`) and
**§11.4.2.1** (the Capacity screen paragraph). Nothing else outside
`server/` and `server/web/`.

**Per criterion**

- **Server load.** `loadOf` (`server/src/services/presence.ts`) reads
  `committed` = in progress + to do. Thresholds unchanged in value, now on
  committed work, and stated in SPEC §9.3: heavy above **5** in progress or
  above **15** committed; light at most **2** in progress and at most **5**
  committed; none with nothing committed. Overdue is not read; it is still
  served as `workload.overdue` (and per space).
- **Counts.** `CapacityWorkload` now has `todo` (To do only), `backlog`,
  `in_review`, `committed`. The card shows *in progress · to do · backlog*,
  a bar of committed work only, and apart from it *N waiting on reviewers*
  and *due in 7 days*. Space chips show committed work; backlog and review
  are in the chip's hover title and in visually-hidden text.
- **Per-space badge.** **The server sends it**: each `spaces[]` entry carries
  its own `load` by `loadOf`. The web reads it through `loadIn` for the
  badge, the *Heavy load* chip and the load sort. Overdue is its own *N
  overdue* badge beside the load badge.
- **Activity.** **Bookkeeping is shown apart.** New gated field
  `activity_14d_split: { by_self, by_agents, bookkeeping }`. Bookkeeping is
  `sprint.tasks_changed`, plus `task.updated` naming `position` (the web's
  `isReorder`, D-060.4), counted from `activity` over the 14-day window
  through `activity_org_created_at_idx` (a query-plan test holds it to the
  index). `by_self` and `by_agents` are the §4.22 rollup less that
  bookkeeping, so the three sum to `activity_14d`. The card reads *N by hand
  · N by agents · N bookkeeping* under the sparkline.
- **Review total.** **"200+"** when `GET /review` says `truncated`; the cap
  is not raised and the server is unchanged. `useReviewCount` exposes
  `capped`, passed through the shell to Capacity. A true `total` from the
  server is already LAI-820's criterion, so it is left there.
- **Contract.** Client types mirror the server. `web/test/api/presence.test.ts`
  now also compares `CapacityWorkload`, `CapacitySpace` and `ActivitySplit`
  field by field, optionality included, and `activity_14d_split` joins the
  gated (optional) list.
- **Tests (fail on today's code).** Server
  `server/test/services/presence.test.ts`: 10 new or changed cases red on
  e07647a9 (100 in review is `heavy` there), green after. Web
  `capacity-derive.test.ts` and `api/presence.test.ts` red on today's web
  code, green after. Browser `capacity.test.ts` adds the per-space badge,
  counts apart with the overdue badge, the activity split, and the 200+ tile.
  **Mutations**, each confirmed landed by checksum and restored by checksum:
  (1) count review as load again: 4 server cases red, including "a person
  with 0 in progress, 0 to do and 100 in review is not Heavy"; (2) the Heavy
  filter back to the global load: "Heavy load reads the chosen space's load"
  red; (3) overdue as a Heavy trigger again: 3 server cases red, including
  "overdue alone is not Heavy"; (4) the split keeping bookkeeping in
  by_agents: the split case red.
- **Screenshots.** `/tmp/laika-capacity-shots/`: `before-` and `after-`,
  `light` and `dark`, `1440` and `390` (8 files). Same production-shaped org
  served in the old and new payload shapes.
- **Gate (left unticked, explained).** The repo-root `pnpm test` ran twice on
  a hot machine with the three workspaces in parallel, and exited **1** both
  times. Run 1 found one real failure, which this branch caused and fixed:
  `store-requests.test.ts` had a capacity fixture in the old workload shape
  (commit 65cdd9b7). Run 2 failed only on timing:
  `member-profile.test.ts` (minute-boundary drift, "21 min" against "20
  min"), `task-panel.test.ts` (a members-list race), and cli
  `activity-hook.test.ts`. Each passes alone (37/37, 16/16, 87/87).
  `sprints.test.ts` timed out in run 1 and passes alone (43/43). Because
  `pnpm -r` stops at the first failing workspace, neither root run finished
  the server suite, so each workspace's own `pnpm test` was then run one
  after another: **server 0** (3303 passed, 10 skipped), **web 0** (2338
  passed), **cli 0** (530 passed, 2 skipped). **`pnpm lint` 0** (after fixing
  one `prefer-string-starts-ends-with` in the new browser test; web typecheck
  re-run 0), **`pnpm format` 0**. The root command itself has not been seen
  to exit 0 here; polly gates on master.

