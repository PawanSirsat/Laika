---
id: LAI-552
title: 'Resource watcher (battery <15% unplugged, memory pressure 60s, hysteresis, unsupported reported)'
area: cli
assignee: shell
priority: p1
depends-on: [LAI-547]
discovered-from:
status: in-progress
started: 2026-10-31T09:03:11Z
---

Implements **proposal §4.7 (`laika agent watch`)** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

Before a laptop dies, the helper warns and triggers a checkpoint:
battery under 15 % while unplugged, or memory pressure sustained for 60 s, with
hysteresis so it does not flap; unsupported metrics are reported as such.

## Scope

- `laika agent watch` on macOS first; other OSes report `unsupported`.
- Triggers `laika agent checkpoint`.

## Out of scope

- Live notices (LAI-554)

## Acceptance criteria

- [ ] Thresholds and hysteresis covered by tests with injected readings.
- [ ] An unsupported metric is printed as unsupported, never as zero.
- [ ] Repo-root gate exits 0.

## Tests and UI evidence required

Node tests with a fake metrics source.

## Dependencies

`depends-on: [LAI-547]`.

## Role / machine

SHELL on Belka. Owner area: `cli` (SHELL).

## Priority

P1 — board priority `p1`.

## Effort

1.5 days, confidence M.

## Branch

`LAI-552-resource-watcher`

## Migration / rollout notes

Opt-in.
