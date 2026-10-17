---
id: LAI-777
title: 'Codex: a forked rollout without per-response records may count its copied history twice'
area: cli
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-769
status: backlog
---

## Goal

LAI-769 counts a Codex rollout by its `token_usage_record` lines when it has
them — each response once, by `response_id`, across every rollout — so a fork
that copies its parent's records is counted once. **A rollout without those
records** (older Codex) is counted as the day's difference of its cumulative
`total_token_usage`; if a fork copies its parent's `token_count` events, the
copied history would be counted again.

**Not verified either way:** on the measured machine, 12 rollouts, 3 with
per-response records, none sharing a `response_id` with another — no fork to
look at.

## Acceptance criteria

- [ ] Measured on a machine with a forked Codex session: whether a fork copies
      `token_count` events, and whether its first cumulative total starts at
      the parent's.
- [ ] If it does, the collector counts the copied history once (e.g. by
      starting a fork's baseline at its first copied total), with a test.
- [ ] Root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
