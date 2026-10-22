---
id: LAI-872
title: "Builders missing from `dispatched` stay in `excluded`, so their telemetry never counts as the person's"
area: cli
assignee: strelka
priority: p1
depends-on: []
discovered-from: LAI-315
status: backlog
---

## Goal

A builder the owner dispatched through Omnigent never adds telemetry to the
person's figures. Its session key reaches the board in the day's `dispatched`
or, failing that, in `excluded`, every time. It is never in neither.

This is live. Since PR #37, LAI-867 turns telemetry on in
`~/.claude/settings.json`, which every builder reads. A builder missing from
both lists has its points kept as the person's, against D-088 item 9 (*"the
agents it dispatches do not"* count as the person's work) and D-091 item 1
(*"They count toward no per-person figure"*).

## What is there today (read at `9250fc3e`)

- `daysOf` builds `excluded` from every `skip-sessions` id, then takes out
  every dispatched builder: `.filter((id) => !dispatchedIds.has(id))`
  (`cli/src/activity-usage.ts:2519`). The comment above it (`:2511-2512`)
  says a builder *"is named in its day's `dispatched` instead"*.
- That is true only when a day carries the builder. It does not when:
  - the builder has no worked bucket. `workedBuckets` returns `undefined`
    (`:733-757`) for one reply, or when every gap is over 15 minutes
    (`DISPATCHED_IDLE_S`), and the lane loop skips it (`:2223-2224`);
  - it worked before counting began, so no day in the window holds it;
  - its day has no rows: `outDispatched` is set only when `rows.length > 0`
    (`:2505`);
  - its day has more than 50 builders (`DISPATCHED_PER_DAY_MAX`, `:2120`;
    `:2763-2767`);
  - the day does not fit 16 KiB with them, and the fallback sends it without
    `dispatched` (`:2772`).
- `usageReports` gives every report the same `excluded` (`:2716-2722`), so a
  day sent without its `dispatched` adds nothing to it.
- The board drops a point only when its key is in `token_session_skips`
  (`server/src/services/token-telemetry.ts:790-807`). `storeExcluded` puts
  `excluded` and `dispatched` keys there and nothing else (`:440-452`).
- The comment at `token-telemetry.ts:650` says the collector names those
  sessions *"in `excluded` whenever this machine sends telemetry, or in
  `dispatched` (LAI-315)"*. The cases above make it claim more than the code
  does.

## Acceptance criteria

- [ ] **In `daysOf`**, a builder leaves `excluded` only if its key is carried
      in some day's `dispatched`:
      `.filter((id) => !carried.has(sessionKey(id)))`, where `carried` is the
      keys in `outDispatched`. Builders that are not carried stay in
      `excluded`, newest first, as today.
- [ ] **In `usageReports`**, when a day goes out without its `dispatched`
      (over 50, or the 16 KiB fallback), those builders' keys are added to
      that report's `excluded`. Only when telemetry is on, as `excluded` is
      today, and still bounded by `EXCLUDED_MAX` and the body size.
- [ ] **Test (cli): a one-reply builder.** With telemetry on, a dispatched
      builder with one reply ends up in the report's `excluded`. This fails
      today: `excluded` is absent and the day carries no `dispatched` (the
      review's run printed `[null]`). Run it red first.
- [ ] **Test (cli): the two fallbacks.** A day with 51 builders, and a day
      that fits 16 KiB only without its `dispatched`: each builder on that day
      is in that report's `excluded`. A builder carried in `dispatched` is
      still not in `excluded`, so LAI-315's test of that stays green
      unedited.
- [ ] **Mutation.** Restore `!dispatchedIds.has(id)` in place of the carried
      check. The one-reply test goes red with an assertion error. Prove the
      mutation landed (a unique anchor and a `grep`), restore the file in a
      trap, and record the run here.
- [ ] **The comment** at `server/src/services/token-telemetry.ts:650` says
      what the collector now does: a builder is named in `dispatched` when its
      day carries it, and in `excluded` otherwise. Comment only, no code.
- [ ] **One more comment, from the same #28 review.** The comment at
      `cli/src/activity-time.ts:617-620` says a builder's commit lands in
      *"the stretch's first block"*. The code (`:629-630`) puts it in the
      block of the first key of the minute it lands in. The comment says what
      the code does. Comment only, no code.
- [ ] Gate: repo-root `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Builds on **Strelka** (D-097; board tag `host-strelka`).
- **Files:** `cli/src/activity-usage.ts`, `cli/test/activity-usage*.test.ts`,
  the comment at `cli/src/activity-time.ts:617-620`, and the comment at
  `server/src/services/token-telemetry.ts:650`. No other server change: the
  receiver already drops every key it is given.
- **Privacy is unchanged** (D-088, D-091). `excluded` already carries these
  hashed session keys. Nothing new leaves the machine.
- **This is the fix Belka asked for in the PR #28 review** (on LAIKA-670).
  #28 shipped in PR #37 before the fix landed, so it is a task of its own.
