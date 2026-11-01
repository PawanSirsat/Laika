---
id: LAI-574
title: 'CI lint dies out of memory (exit 134) on the smaller runner since the repo went private'
area: ops
assignee: chief
priority: p1
depends-on: []
discovered-from:
started: 2026-10-28T09:06:02Z
finished: 2026-10-28T10:05:37Z
status: done
accepted: 2026-10-29T13:57:10Z
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

- [x] The `Lint` step in `.github/workflows/deploy.yml` carries
      `env: NODE_OPTIONS: --max-old-space-size=4096`, scoped to that step;
      nothing else in the workflow changes.
- [x] Locally, `NODE_OPTIONS=--max-old-space-size=4096 pnpm lint` exits 0,
      with its peak memory recorded; `pnpm format` exits 0.
- [x] A pull request into `master` runs the gate, and its `Lint` step exits 0;
      its duration, and whether `Test` fits the job's `timeout-minutes: 40`,
      are reported. A timeout change is not made here — it is a second line
      and goes back to CHIEF first.

## Notes

Ships alone, as its own pull request, ahead of anything else waiting on a
green gate.

## Builder notes

- Commit `1b07af63`: `.github/workflows/deploy.yml` only, +3 lines on the
  `Lint` step (one comment, `env:`, `NODE_OPTIONS`). Nothing else changed.
  Ruby Psych parses the file, and the step reads
  `{"env"=>{"NODE_OPTIONS"=>"--max-old-space-size=4096"}, "run"=>"pnpm lint"}`.
- Local: `NODE_OPTIONS=--max-old-space-size=4096 /usr/bin/time -l pnpm lint`
  exited 0 in 142 s with peak RSS 2.92 GB, which is above the 2 GB default heap
  that failed. `pnpm format` exited 0. `pnpm test` was skipped because the load
  average was about 27 (above 20); the CI run below is the test.
- CI: PR #109, run 40662261392, `pull_request` on head `1b07af63`, success.
  Lint took 1 m 40 s (09:11:44–09:13:24Z), exit 0. Format took 34 s. Test took
  33 m 28 s (09:13:58–09:47:26Z), exit 0. The whole gate job took 36 m 21 s,
  against `timeout-minutes: 40`.
- **For CHIEF: Test fits, but only by about 3.6 minutes.** A slower runner or a
  few more browser tests would push the gate past 40. Changing the timeout is a
  second line, so it is not made here; whether to raise it is CHIEF's call.
  The Chromium install took 24 s on this run, not the ~8 min the investigation
  saw, so the install time varies a lot between runs.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #109.
