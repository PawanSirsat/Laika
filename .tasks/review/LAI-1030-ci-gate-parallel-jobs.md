---
id: LAI-1030
title: 'The CI gate runs as parallel jobs — same tests, ~10–15 minutes instead of ~25–42'
area: docs
assignee: chief
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-11-01T15:05:00Z
finished: 2026-11-01T15:10:00Z
---

Owner-approved 2026-11-01 (chat, dispatched by polly). Board: LAIKA-886.
Scope: `.github/workflows/deploy.yml` only — the gate's jobs, and the
`needs:` of `deploy`. Build and deploy steps are not touched.

## Goal

Every PR and every master push waits for one `Gate — test, lint, format` job
that runs lint, format and the repo-root `pnpm test` serially in one runner:
~25 minutes on a good day (run 41312046501: job 24m39s, Test step 21m57s with
server vitest, web `node --test` and cli `node --test` sharing four vCPUs).
Split it into parallel jobs so the wall-clock is roughly 10–15 minutes,
without dropping a test and without weakening D-073: a red gate still blocks
the deploy on master.

## Acceptance criteria

- [x] Lint + format, the server vitest suite, the web `node --test` suite and
      the cli `node --test` suite run in parallel jobs; the server and web
      suites are sharded. Each job keeps `timeout-minutes: 60`.
- [x] Each test job runs the package's own `test` script (typecheck and the
      script's own glob), so `test-runner.test.ts` still guards what CI runs.
- [x] One aggregate job named `Gate — test, lint, format` `needs:` every
      gate job and fails unless every one succeeded; `deploy` `needs:` it.
- [x] Before/after wall-clock reported with run ids.
- [x] Tests executed, summed over the shards, match a pre-change run (no test
      silently dropped).
- [x] A deliberately failing shard turns the aggregate red (one throwaway
      commit, then reverted), with the run id.
- [x] The LAI-579 non-blocking-on-master change (#118) is not in this diff.
