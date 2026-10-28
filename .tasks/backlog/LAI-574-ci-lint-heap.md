---
id: LAI-574
title: 'CI lint dies out of memory (exit 134) on the smaller runner since the repo went private'
area: ops
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

Since the repo became private (2026-10-27 ~17:56Z) the `gate` job runs on a
smaller `ubuntu-latest` runner, where Node's default heap is about 2 GB.
`pnpm lint` (`eslint .`, type-aware) needs more than that and aborts with exit
134 on every pull request, a docs-only branch included. A push to `master`
would fail the same way and block every deploy. Locally,
`NODE_OPTIONS=--max-old-space-size=2048 pnpm lint` fails too (peak RSS
2.22 GB).

## Scope — the exact file this task may edit (CLAUDE.md §1)

- `.github/workflows/deploy.yml` — the `Lint` step only.

## Acceptance criteria

- [ ] The `Lint` step in `.github/workflows/deploy.yml` carries
      `env: NODE_OPTIONS: --max-old-space-size=4096`, scoped to that step;
      nothing else in the workflow changes.
- [ ] Locally, `NODE_OPTIONS=--max-old-space-size=4096 pnpm lint` exits 0,
      with its peak memory recorded; `pnpm format` exits 0.
- [ ] A pull request into `master` runs the gate, and its `Lint` step exits 0;
      its duration, and whether `Test` fits the job's `timeout-minutes: 40`,
      are reported. A timeout change is not made here — it is a second line
      and goes back to CHIEF first.

## Notes

Ships alone, as its own pull request, ahead of anything else waiting on a
green gate.
