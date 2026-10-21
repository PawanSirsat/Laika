---
id: LAI-836
title: 'SPEC §4 and §6.4 for LAI-831''s server additions: breaks, undo, a block''s span, drafts held'
area: docs
assignee: chief
priority: p2
depends-on: [LAI-831]
discovered-from: LAI-831
status: done
started: 2026-10-21T05:37:43Z
finished: 2026-10-21T06:26:24Z
accepted: 2026-10-21T11:17:31Z
---

## Goal

LAI-831 (owner-direct, My day v2) added to the server what the owner's design
and CHIEF's additions B, C, D and F needed. `docs/` is CHIEF's, so the SPEC
half is this task. The two new tables carry an exemption in
`server/test/tooling/schema-spec-drift.test.ts`'s `TABLES_NOT_IN_SPEC` that
names this task; it goes stale — and must be removed — once §4 describes
them.

## What to write (LAI-831's task file, *Server changes*, is the record)

- **§4**: `time_breaks` (a gap a person waved away; per person and day; kept
  30 days with drafts) and `time_undo` (a change's before-image, kept
  minutes; the person's own).
- **§6.4**: `POST /me/time-breaks`, `DELETE /me/time-breaks/:id`,
  `POST /me/time/undo`; `started_at` and `ended_at` on `PATCH
  /me/time-drafts/:id` and `PATCH /me/time-entries/:id`; `breaks` and
  `drafts_held` on `GET /me/time`.
- **§11.6**: both tables in time retention.

## Acceptance criteria

- [x] §4, §6.4 and §11.6 say the above, quoting the code.
- [x] The two `TABLES_NOT_IN_SPEC` entries go stale the moment §4 describes
      the tables (the staleness guard says so); they are removed in the merge
      that lands this, by §4.4's procedure.
- [x] The gate exits 0.

## Result (the builder, for CHIEF, 2026-10-21)

Branch `LAI-836-my-day-v2-spec`, cut from `master` `d36d2ee5`. Commits:
`16d3c5c6` claim, `c4125a12` SPEC, `56c60d3b` the two exemptions out,
`9f88ce9d` LAI-844 and LAI-845 filed, then this file and the log.

### SPEC sections changed, and the code each statement is quoted from

Paths are under `server/src/` unless stated.

- **§4.55 `time_breaks`** (new). Columns, the CHECK and both indexes:
  `db/schema.ts:2386-2407`, `db/migrations/0044_time_breaks_and_undo.sql:10-23`.
  "Never time": `db/schema.ts:2378-2385`, `services/time-breaks.ts:11-22`.
  Read under `time_drafts.read_own` (`services/my-day.ts:95`, `:113`);
  written under `time_drafts.manage_own` (`services/time-breaks.ts:72`,
  `:127`). 48 a day and no overlap: `services/time-breaks.ts:25`, `:78-103`.
  Kept 30 days: `jobs/jobs.ts:204`, `:235`. Neither switch nor
  `DELETE /me/time-drafts` removes one: `forgetDrafts`
  (`services/time-settings.ts:86-99`) and `deleteOwnDrafts`
  (`services/time-drafts.ts:888-902`) touch drafts and undo rows only.
- **§4.56 `time_undo`** (new). Columns and indexes: `db/schema.ts:2418-2435`,
  `0044_…sql:24-34`. `id` is the `X-Undo-Id`: `services/time-undo-log.ts:27`,
  `:56-71`, `http/routes/time.ts:257-261`. `subject`: `db/schema.ts:2425`,
  `daySubject` `services/time-undo-log.ts:49`. `change`'s four keys:
  `services/time-undo-log.ts:37-46`. `created_at` = every written row's
  `updated_at`: `services/time-undo.ts:108-125`. Two minutes, ten seconds:
  `services/time-undo-log.ts:13`, `:20`. Sweeps: `recordUndo`
  (`time-undo-log.ts:63-65`), Undo deletes its own (`time-undo.ts:138`),
  `deleteOwnDrafts` (`time-drafts.ts:900`), the switches
  (`time-settings.ts:96-98`, called at `:127` for one person and `:149` for
  everybody).
- **§6.4 endpoint block.** `PATCH /me/time-drafts/:id` gains `started_at?`
  and `ended_at?` (`http/routes/time.ts:126-134`). `GET /me/time` names breaks
  and drafts held. New lines: `POST /me/time/undo` (`time.ts:163`, `:329-333`)
  and `POST /me/time-breaks` with `DELETE …/:id` (`time.ts:160`, `:335-343`).
- **§6.4 Time prose.**
  - *My day*: `breaks` and `drafts_held` (`services/my-day.ts:59-65`,
    `:113-114`, `:172-173`). `drafts_held` counts pending only
    (`services/time-drafts.ts:910-920`). Switching off also deletes dismissed
    drafts (`time-settings.ts:89`), so the SPEC says they go and are not
    counted.
  - *The person's hands*: the draft edge refusals come from `patchedSpan` and
    `updateDraft` (`services/time-drafts.ts:597-619`, `:647-658`) and from
    `assertSpanOnDay` and `assertWithinSpan` (`services/time-entries.ts:170-197`).
    Dismiss "for good, but for Undo". One entry per block, revived on
    re-confirm: `time-drafts.ts:785-802`. The entry `PATCH` span:
    `services/time-entries.ts:652-702`, two edits at `:660-665`, `no_span` at
    `:668-673`, one revision at `:713-730`.
  - *By the clock* (new bullet): `stretchAround`, `assertFitsTheClock` and
    `assertLeftBehindFits` (`services/time-entries.ts:205-318`), plus the
    callers: `updateDraft` (`time-drafts.ts:654-658`), `confirmRow`
    (`:772-774`), *Confirm day* (`:861-869`), `createEntry`
    (`time-entries.ts:561-564`), `updateEntry` (`:693-702`, `:731-737`) and
    `reviveEntry` (`:851-853`).
  - *Undo* (new bullet): `services/time-undo.ts:67-139`. The routes that
    answer `X-Undo-Id` are `http/routes/time.ts:296`, `:303`, `:308`, `:315`,
    `:321`, `:348` and `:359`; `:354` (entry `PATCH`) does not. Day confirm
    records only when it confirmed something: `time-drafts.ts:873-879`.
  - *Breaks* (new bullet): `services/time-breaks.ts:61-133`. The day window
    is `assertEntryDay` (`services/time-entries.ts:44`, `:145-163`).
- **§11.6 time retention**: `jobs/jobs.ts:234-239`, scheduled daily and at
  start (`jobs/scheduler.ts:90`).

Not touched: §3.1, §3.4, §11.4.2, and the `POST /me/time-entries` body line.
Each now says less than the code, and none was in this task's sections.
Filed as LAI-844.

### Where LAI-831's task file and the code disagree (the code won)

1. *Server changes* says `POST /me/time/undo` takes `{ draft | entry | day }`.
   The code takes `{ id }` (`http/routes/time.ts:163`): the id a recorded
   change answered with in `X-Undo-Id`. Review round 1 changed it, and the
   *Server changes* list was not updated.
2. *Server changes* names only `409 changed_since`. The code also refuses
   `409 newer_change` (`services/time-undo.ts:97-103`), and an entry brought
   back can meet `409 overlaps_confirmed` or `422 day_full`
   (`time-entries.ts:851-853`, `:818`).
3. *Server changes* gives the draft `PATCH` refusals as `422 no_span |
   invalid_span | outside_day | minutes_over_span`. Since review rounds 1
   and 2 the code also answers `409 overlaps_confirmed`, the by-the-clock
   rule. That rule also reaches confirm, *Confirm day* and a timed entry's
   create, endpoints LAI-836's list did not name. Because it is LAI-831's,
   §6.4 now describes it.
4. *Server changes* says time-breaks are "on its own day, no overlap, at most
   48 a day". The code also needs the organisation's *Time* not `off`
   (`403 time_off`, `services/time-breaks.ts:73`), takes days back to
   today − 365, and refuses the 49th break with reason `too_many_breaks`.
5. `heldDrafts`' docblock and `MyDayView.drafts_held` say it counts "what
   turning *Draft my time* off would delete". The switch also deletes
   dismissed drafts, which are not counted. The SPEC says exactly what is
   counted. The comments are CORE's; noted here, not filed.
6. LAI-836's own title says "§4 and §6.4" and its body says §11.6 too. All
   three are done.

### The staleness guard: red, then green

`cd server && npx vitest run test/tooling/schema-spec-drift.test.ts`:

| tree | exit | result |
| --- | --- | --- |
| `d36d2ee5` + claim, untouched | 0 | 35 passed (35) |
| §4.55/§4.56 written, both entries still present | **1** | 1 failed, 34 passed. `drops a table exemption once §4 describes the table` received `"time_breaks — exempted, but it is no longer an undocumented table; remove the entry"` and the same for `time_undo` |
| entries removed (`56c60d3b`) | 0 | 35 passed (35) |
| converse: §4.55/§4.56 cut from a copy, entries removed | **1** | 1 failed: `has a §4 section for every table` names both tables. The SPEC was restored from a checksummed backup, and the checksum matched |

The red run shows the column checks in both directions and the nullability
checks passing on the new sections. So no new exemption was needed, and
`statedNullability` reads nothing from them: neither section uses the word
`nullable`.

### Every guard that reads `docs/SPEC.md`, run on the finished SPEC

Swept with a grep for readers of `docs/SPEC.md` across `server/test`,
`server/web/test` and `cli/test`. None reads §6.4 or §11.6. Results:

- `cd server && npx vitest run test/tooling/schema-spec-drift.test.ts test/mcp/parity.test.ts test/tooling/policy-spec-drift.test.ts test/errors.test.ts test/tooling/env-contract.test.ts test/tooling/task-file-state.test.ts`
  → exit 0, 6 files, 354 test cases passed.
- `cd cli && node --test test/plugin-mcp.test.ts` → exit 0, 7 passed.
- `cd server/web && node --test test/routes/screens/projects/context-copy.test.ts`
  → exit 0, 5 passed.

### Gate

Repo root, `9f88ce9d` (the three code-and-docs commits and the filings;
this file and the log are Markdown, outside both `pnpm test` and Prettier),
`pnpm format:fix` first. It changed nothing.

```
pnpm test   > /tmp/lai836-gate.txt 2>&1; echo "TEST $?"
pnpm lint   > /tmp/lai836-lint.txt 2>&1; echo "LINT $?"
pnpm format > /tmp/lai836-fmt.txt  2>&1; echo "FMT $?"
grep -E "Unhandled|Errors|Failed|not ok|✗" /tmp/lai836-gate.txt
```

**Run 1, 05:51–06:04Z, load average ~16 to 35: `TEST 1`, `LINT 0`,
`FMT 0`.** Red, and none of the failures is in this change:

- `cli/test/activity-lookback.test.ts:817`, *"a look-back still under way
  when the deadline nears stops itself; the snapshot stands"*: *"the snapshot
  was not sent, 2 !== 1"*, after 17.6 s.
- `server/web/test/browser/my-day-v2.test.ts:950`, *"a font wider than ours:
  a gap, a break, a block's figures and the week's are never cut"*:
  *"1440 folded=false: cut"*, `['dayline-block-sub: 1:00–2:50 PM · 1 h
  50 min']`.
- `server/test/tooling/response-type-coverage.test.ts`: *"rules on every
  response-shaped name the census cannot see"* (8306 ms) and *"keeps
  NOT_SERVED honest"* (9569 ms).
- **`pnpm -r` bailed on `cli`** (`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`), so
  `server` and `server/web` never printed a summary. Run 1 is incomplete as
  well as red.

**Each failing file alone, right after, load ~31–36: all green.**
`cd server && npx vitest run test/tooling/response-type-coverage.test.ts` →
exit 0, 10 passed (10). `cd cli && node --test test/activity-lookback.test.ts`
→ exit 0, 27 pass, 0 fail. `cd server/web && node --test
test/browser/my-day-v2.test.ts` → exit 0, 31 pass, 0 fail.

**Run 2, the root gate again, 06:10–06:25Z: `TEST 0`, `LINT 0`, `FMT 0`.**
The grep finds only a test named `fieldErrors`. Every workspace printed its
summary:

- `server`: Test Files 165 passed, 2 skipped (167). Tests 3375 passed, 10
  skipped (3385).
- `server/web`: tests 2630, pass 2630, fail 0.
- `cli`: tests 535, pass 533, skipped 2, fail 0.
