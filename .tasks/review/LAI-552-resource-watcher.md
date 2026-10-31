---
id: LAI-552
title: 'Resource watcher (battery <15% unplugged, memory pressure 60s, hysteresis, unsupported reported)'
area: cli
assignee: shell
priority: p1
depends-on: [LAI-547]
discovered-from:
status: review
finished: 2026-10-31T09:12:37Z
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

- [x] Thresholds and hysteresis covered by tests with injected readings.
- [x] An unsupported metric is printed as unsupported, never as zero.
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

## Build notes (SHELL on Belka, 2026-10-31)

- **Dependency deviation, recorded:** `depends-on: [LAI-547]` is in
  `.tasks/review/` on `master`, not `done/` (merged in #154). Claimed on the
  orchestrator's dispatch, which named #154 as the base.
- **Repo-root gate is left unticked:** Belka does not run the full suite
  locally (resource rule). Ran: `node --test --test-concurrency=1
  test/agent-watch.test.ts` (exit 0), `tsc -p cli/tsconfig.json --noEmit`
  (exit 0), eslint and `prettier --check` on the three touched files (exit 0).
  CI on the PR runs the repo-root gate; the box is ticked when it is green.
- **`memory_pressure` is not used:** run without flags it allocates memory
  until the system is under pressure. The watcher reads
  `sysctl -n kern.memorystatus_vm_pressure_level`, the level that tool reports.
- **The offer is opt-in (`--offer-to <agent id>`):** a hand-off must name its
  receiver and needs a `verified` checkpoint (SPEC §4.73), and it pauses the
  sender's claim, so the watcher never offers by default.
- Deliberate breaks: 15 mutations of `cli/src/agent-watch.ts`, every one red
  (two survived the first run; tests added for both).

