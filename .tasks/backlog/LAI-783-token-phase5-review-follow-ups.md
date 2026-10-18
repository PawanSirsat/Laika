---
id: LAI-783
title: 'Token usage phase 3 follow-ups: runaway progress tied to the task, two telemetry under-counts, the price table at 390 px'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-773]
discovered-from: LAI-773
status: backlog
---

## Goal

The LAI-773 review (round 1) found three things it did not hold the task for,
and the orchestrator filed them here rather than in that round. Items 1 and 2
are in `server/src/`; item 3 is in `server/web/` (SHELL's area — split it out
if it is taken separately).

Lines as of `818d70d8` on `LAI-773-token-phase5`.

1. **The runaway rule counts the assignee's pushed commit on any task as
   progress.** `lastProgress` (`server/src/services/token-budgets.ts:743`)
   takes `max(pushed_commit_keys.created_at)` for the assignee over the last
   two days (`:753`) with no task in the query: a push for task B silences a
   runaway alert on task A for an hour. `pushed_commit_keys` (§4.24) carries no
   task, so the fix is either a task signal the key can carry (a branch's task
   key, as heartbeats resolve one) or dropping the signal from the rule and
   saying so in SPEC §6.4 and D-087.
2. **Two ways telemetry can under-count** (never double count; both are a
   floor):
   - **A cumulative series first seen more than five minutes after it began
     is a baseline** (`FIRST_SIGHT_MS`, `token-telemetry.ts:787-791`): its first
     value is never counted. That is right for tokens from before consent, and
     wrong for a session whose first exports never arrived (Laika unreachable,
     or restarted), whose post-consent tokens are then lost.
   - **Two points in one interval for one series key.** The key is session
     key, model, count and a cumulative series' start (`:755-756`). If Claude
     Code sends two points for the same key and interval that differ only in
     an attribute Laika does not read, the delta path takes the first and
     drops the second (`startMs < lastEndMs`, `:798`), and the cumulative
     path keeps only the larger value. Whether Claude Code ever does is **not
     confirmed**: check code.claude.com/docs/en/monitoring-usage, and sum
     same-interval points per key before the series check if it does.
3. **The Organisation page's price table hides its source column at 390 px**
   (`server/web/src/routes/screens/organisation/ModelPricesSection.tsx`):
   where a price came from is the one thing that says a row was inferred.

## Acceptance criteria

- [ ] 1: a push for another task does not count as progress on this one; a
  test with the assignee pushing on a second task still raises the runaway
  alert on the first, and a push tied to the first still holds it.
- [ ] 2a: either a late-seen cumulative series whose tokens Laika can tell
  are post-consent is counted, or SPEC §4.39 states exactly what is lost; a
  test pins whichever is chosen.
- [ ] 2b: the attribute question is answered from the source and quoted; if
  two points can share a key and an interval, both count, once each, with a
  test that resends them.
- [ ] 3: at 390 px, light and dark, each price row shows its source (or an
  inferred mark) without sideways scroll; a browser test reads it.
- [ ] Root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
