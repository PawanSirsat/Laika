---
id: LAI-315
title: 'My day''s AGENTS lane shows the minutes of the builders the owner dispatched through Omnigent'
area: server
assignee: strelka
priority: p1
depends-on: []
discovered-from: LAI-833
started: 2026-10-21T19:16:32Z
status: done
accepted: 2026-10-29T13:57:10Z
finished: 2026-10-21T19:32:14Z
---

## Owner decision (2026-10-22, amends D-091 / LAI-787 for the lane only)

Verbatim:

> My day's AGENTS lane should show the agent minutes of builders the owner
> dispatched through Omnigent (sessions tagged `omnigent` in
> ~/.laika/activity/skip-sessions), tied to the builder's card where known (its
> start_working mark, else its LAI-NNN branch). They stay BESIDE the day, never
> added to the owner's hours, contribution or confirmed time, and remain marked
> automated everywhere else.

## Goal

The AGENTS lane (`agent.lane` of `GET /me/time`, LAI-833) draws the five-minute
buckets in which a dispatched builder worked, each on a card where the builder's
own marks or branch tie it. Nothing else moves: agent `minutes`, `by_task`,
hours, contribution and confirmed time stay as they are, and the builder's
tokens stay in rows marked automated.

## What was measured

- The lane is filled only by the OTel receiver, and with telemetry on the
  collector names every `skip-sessions` id in `excluded`, so the receiver drops
  a builder's points (`token-telemetry.ts`, `activity-usage.ts`).
- **OTel cannot cover the builders.** A builder Omnigent dispatched, measured
  from inside one on 2026-10-22, has no `CLAUDE_CODE_ENABLE_TELEMETRY` or
  `OTEL_*` in its environment: it inherits Omnigent's, not `~/.zshrc`. So the
  lane's buckets for a builder are derived from its Claude Code transcripts,
  which the collector already reads for tokens.

## Shape

Two halves, one PR (Strelka handover), files kept apart:

- **cli/** — the collector computes, per day and dispatched session, the
  seconds the session worked per five minutes from its replies' times, and the
  card its replies are tied to, and sends them as the day's `dispatched`
  (`{ key, task?, from, seconds[] }`). Sent whether or not telemetry is on. A
  dispatched session's key is no longer in `excluded`.
- **server/src/** — a usage report's `dispatched` replaces that day's buckets
  for those keys in `agent_time_buckets`, keeps the key in
  `token_session_skips` so its telemetry is still dropped, and ties it to its
  card through `token_session_tasks`. `agentDay()` draws them on the lane; no
  `agent_time_days` row is written for them, so the minutes are untouched.

## Acceptance criteria

- [x] A dispatched session's replies become `dispatched` buckets on their day,
      tied to its card; a person's session and a non-Omnigent automated session
      send none (cli test).
- [x] With telemetry on, a dispatched session's key is not in `excluded`; a
      `CI` / `LAIKA_ACTIVITY_SKIP` session's still is (cli test).
- [x] A usage report's `dispatched` puts the buckets on My day's lane, on a
      card when the session is tied, and a resend replaces rather than adds
      (server test).
- [x] The dispatched minutes are in no `agent.minutes`, `by_task`, or
      person's hours (server test).
- [x] Telemetry for a dispatched key is still dropped at receipt (server test).
- [x] Root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Notes

- `docs/SPEC.md` §4.57 and §6.4 describe the lane as OTel-only and do not name
  `dispatched`; that is CHIEF's to amend (LAI-316 records the decision).
- No schema change: a bucket of a key in `token_session_skips` can only have
  come from `dispatched`, because the receiver drops a skipped key's points and
  `excluded` drops its buckets.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #27, #28.
