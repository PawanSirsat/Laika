---
id: LAI-834
title: 'A drafted block''s signals are counts with no time: My day cannot draw its SIGNALS lane'
area: server
assignee: chief
priority: p3
depends-on: []
discovered-from: LAI-831
status: review
started: 2026-10-21T10:39:06Z
finished: 2026-10-21T11:15:51Z
---

## Goal

The owner's My day design (LAI-831) has a SIGNALS lane: prompts as dots and
commits as ticks, where they happened. LAI-831 left it out and shows each
block's counts as a badge instead (CHIEF's addition G: no invented,
evenly-spaced dots).

## Found (LAI-831's census)

A collector block carries `signals: { prompts, replies, sessions, commits,
marks }` — **counts for the whole block** (`PUT /me/time-drafts`,
`time_drafts.signals`). Nothing says when inside the block they happened.

## Acceptance criteria

- [x] The collector sends, per block, when its prompts and commits happened
      at a coarse resolution (for example, counts per 5-minute bucket) — never
      what was typed, a file name, a branch or a commit message. The closed
      schema keeps refusing anything that could hold text.
- [x] `GET /me/time` serves it to the person alone, on a web session.
- [x] My day draws the SIGNALS lane only where those marks exist, and keeps
      the count badge for a block without them.
- [x] Tests fail on today's code; the gate exits 0.

## Notes

Touches the collector (`cli/` or `plugin/`, SHELL) and the server (CORE).

## The owner's decision (2026-10-21) — D-096

Built on the owner's direct instruction. Asked *"LAI-834: OK to send prompt
and commit timing as 5-minute counts (never text) so the SIGNALS lane can be
drawn?"*, the owner answered **"yes do it"**. That amends D-088 item 3 and is
recorded as **D-096** in `docs/DECISIONS.md`. The change crosses CORE's
server, SHELL's web and CLI, and CHIEF's docs, as a single-agent task done the
way `docs/HANDOVER.md` §4 describes.

## What was built (the builder, 2026-10-21)

Branch `LAI-834-signals-lane`, cut from `master` `d36d2ee5`. **It carries
LAI-859's branch merged in (`69712df9`)**, because both change the drafter
(`cli/src/activity-time.ts`), and this task's collector half extends the blocks
LAI-859's rule builds. LAI-859 merges first; this PR's base is its branch.

- **The wire (D-096).** A block may carry `at: { prompts?, commits? }`, each a
  list of `[bucket, count]` pairs, where a bucket is `floor(unix ms / 300000)`
  (five minutes) and a count is at least 1. Only prompts and commits are
  timed. The route's closed schema takes two integers per pair and nothing
  else (`server/src/http/routes/time.ts`, `buckets`).
- **The board checks it against the block** (`assertBuckets`,
  `server/src/services/time-drafts.ts`): each kind in order, each bucket once,
  inside the block (its last minute included), no more than the block counts.
  Otherwise `422 invalid_blocks`.
- **Kept beside the counts**, in `time_drafts.signals` JSON under `at`. That
  needs no migration, and LAI-822's `0045` stays the next one. They are
  replaced with the collector's blocks and deleted with the drafts, and the
  switch-off blanking of a confirmed draft's `signals` takes them too.
- **Served as the day's lane:** `GET /me/time`'s `signal_times`, `{ prompts,
  commits }`, each `[bucket start in unix ms, count]` in order
  (`signalTimesOn`). It covers every block of the day, whatever became of it,
  since the lane shows what happened. A bucket two blocks share (parallel
  tasks carry their stretch's prompts each) is counted once at its largest.
  It is one more range of `time_drafts_user_day_idx`, and `my-day.test.ts`'s
  section count was raised to say so. It is the person's own, on a web
  session; no token reads it.
- **`GET /me/time-settings` says `signal_times: true`.** The collector sends
  `at` only then, so a board that predates this is never refused an upload
  over it.
- **The collector** (`cli/src/activity-time.ts`) counts each prompt and commit
  in its bucket, inside the block it is counted in (`timeIn`). A commit
  counted in another task's block of its stretch, or evidence a too-short
  block gave its stretch's largest, lands at that block's nearer edge. Times
  merge wherever blocks merge (`mergeTimes`, in the day's cap and the
  rounding). `toBlock` drops a kind whose count the cap cut short.
  `blocksToSend` strips `at` when the board does not take it, or when the
  day's report would pass 16 KB. The sync measures what it sends, so a board
  that starts taking the times gets each day again.
- **My day** (`server/web/src/routes/screens/my-day/`). `dayLine` places the
  marks in minutes after the day's midnight in its zone, leaves out any not on
  the day, and widens the axis to them as it does to blocks. `Timeline.tsx`
  draws a SIGNALS row above the blocks, prompts as dots
  (`--accent-border`) and commits as ticks (`--text-primary`), each centred
  in its five minutes, with a title such as *"2 prompts, 9:10–9:15 AM"*. The
  row is drawn only when the day has marks. Then the label column widens to
  4.75rem for *Signals*, *You* moves down with its row, and the legend gains
  *Prompt* and *Commit*. Every block keeps its count badge, so a day drafted
  without times looks exactly as before.
- **SPEC:** §4.47 (the intro and the `signals` row), §6.4 (the switches and
  the upload, which says how My day serves them back), and §13's privacy
  paragraph. The My day paragraph and the endpoint table were left alone,
  because LAI-836 (in review) rewrites them. A trial merge with LAI-836,
  LAI-822, LAI-858 and LAI-859 was clean (`git merge-tree`, exit 0 each, at
  the time).
- **D-096** in `docs/DECISIONS.md`, after LAI-859's D-095.

## Verification

Every command was run from the worktree root. The counts are collected test
cases.

**Fail first** (the source reverted in a `trap`, restored, and checked by
checksum each time):

| what | command | on today's code |
| --- | --- | --- |
| service | `pnpm --filter @laika/server exec vitest run test/services/time-signal-times.test.ts` | exit 1, 9 of 9 failed |
| route | `pnpm --filter @laika/server exec vitest run test/http/routes/time-signal-times.test.ts` | exit 1, 3 of 3 failed |
| client types | `pnpm --filter @laika/web exec node --test test/api/view-type-drift.test.ts` | exit 1, *"MyDayView.signal_times is served and MyDay does not declare it"* |
| lane marks | `pnpm --filter @laika/web exec node --test test/routes/screens/my-day/signal-marks.test.ts` | exit 1, 5 of 5 failed |
| browser | `pnpm --filter @laika/web exec node --test test/browser/my-day-signals.test.ts` | exit 1, 3 of 4 failed; the 4th is the no-lane regression guard, green on both |
| collector | `pnpm --dir cli exec node --test test/activity-time-signals.test.ts` | exit 1, the module did not export the new names |

**Mutation.** With `timeIn`'s clamp removed (`const held = minute;`),
`activity-time-signals.test.ts` exits 1. Exactly *"keeps a commit that
names another task inside the block it is counted in"* fails, 6 of 7 pass,
and the file was restored and checked by checksum.

**After:**

| command | exit | collected |
| --- | --- | --- |
| server: `vitest run` on the ten time files (the two new ones, `time`, `time-my-day-v2`, `time-settings`, `time-drafts`, `my-day`, `time-drafts.perf`, `time-undo`, `time-breaks`) | 0 | 118 passed, 2 skipped |
| web: `node --test 'test/routes/screens/my-day/*.test.ts' 'test/theme/*.test.ts' test/tokens.test.ts test/theme-single-source.test.ts 'test/api/*.test.ts'` | 0 | 846 passed |
| web: `node --test test/browser/my-day-signals.test.ts` | 0 | 4 passed |
| web: `node --test test/browser/my-day-v2.test.ts test/browser/my-day.test.ts test/browser/my-day-bulk.test.ts` | 0 | 54 passed |
| cli: `pnpm --dir cli run test` (typecheck, then every CLI test) | 0 | 553: 551 passed, 2 skipped |
| `npx tsc --noEmit` in `server/`, and in `server/web/` | 0, 0 | — |

Two existing CLI tests asserted a block's exact shape, and were updated for
the new field, not loosened. *"The evidence: …inside each block"* now names
its exact buckets. LAI-859's *"only a session the hook marked
Omnigent-dispatched lends its card"* still pins the five fields a block always
had. It now allows `at` beside them only if `at` holds nothing but `prompts`
and `commits`, and only numbers. The root gate's exit codes are on the PR and
the card (LAIKA-636).

### Root gate

The gate script was run at the finished code, `4dff1a2e` (clean tree, Vitest
capped at two workers, each command to its own file and `$?`), from 11:08:43Z,
at a 1-minute load of 10.62:

```text
TEST 0
LINT 0
FMT  0
cli test: # pass 551 / # fail 0 / # skipped 2
server/web test: # pass 2639 / # fail 0
server test:  Test Files  167 passed | 2 skipped (169)
server test:       Tests  3387 passed | 10 skipped (3397)
```

The grep matched only the passing test named `completeSetup and
fieldErrors`. After it, only Markdown changed: LAI-859's records merged in,
this file's move to review, and the log. The root gate runs once more on the
final tree before the push; its exit codes are on the PR and the card
(LAIKA-636).

## Not done here

- The lane draws presence per five minutes. A bucket's count is its largest
  over the day's blocks (in the title), not the sum across two machines that
  worked the same five minutes.
- `laika time draft`'s text output does not list the buckets; `--json` shows
  them as built (the sync strips them for a board that does not take them).
- No collector reinstall is needed: `laika` runs from the checkout. A
  machine running an older checkout sends no `at`, and its blocks keep their
  badge.
