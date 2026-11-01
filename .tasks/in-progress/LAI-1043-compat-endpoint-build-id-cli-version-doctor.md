---
id: LAI-1043
title: 'Developer access V3 slice A2: build identity, GET /developer/compatibility, the LAIKA_DEVELOPER_ACCESS flag, laika version and laika doctor'
area: server
assignee: polly
priority: p2
depends-on: []
started: 2026-11-01T20:48:22Z
discovered-from: LAI-1042
status: in-progress
---

Plan: `docs/proposals/LAI-1042-developer-access-v3-plan.md` on branch
`LAI-1042-devaccess-v3-plan`, sections A2, A10, E.6, F.1, F.2, H, I, J slice A
(A2, A2b, A4) and K. Dispatched by the owner through Polly as one slice.

## Goal

The board can say which build it is and what it supports, and a developer's
machine can say which CLI it runs and whether its setup is healthy, before any
V3 onboarding work depends on either. Nothing in the UI changes: the flag
defaults to `classic`.

## Acceptance criteria

- [ ] `LAIKA_BUILD_COMMIT` is read by `readEnv`: unset or empty is `null`, a
      7–40 character lowercase hex string is kept, anything else fails boot with
      an `EnvError` naming the variable.
- [ ] `GET /api/v1/health` keeps `status`, `version` and `uptime_ms` unchanged
      and adds `build_commit` (string or `null`). Old clients that read only the
      three fields are unaffected.
- [ ] `LAIKA_DEVELOPER_ACCESS` is read by `readEnv`: unset or empty is
      `classic`; `classic`, `preview`, `v3` are accepted; anything else fails boot
      with an `EnvError` that names the variable and the three values.
- [ ] `GET /api/v1/developer/compatibility` answers `200` anonymously and
      authenticated with the same body: `server` (version, build commit),
      `protocol` (current, min client), `features` (the closed key set, asserted
      by name, including `developer_access`), `cli` (source url, commit, path,
      the minimum protocol per feature, `whats_new`), and `release_notes`.
      It contains no secret, token, email, path on disk or database value; a
      test asserts the server secret and a minted token's value never appear.
- [ ] The route reads no data (no database, no actor) and is mounted before the
      setup gate's refusal applies, like `/health`. Its `can()` position is
      recorded in the PR: it is the health shape, not a third §5 exception.
- [ ] Docker build takes `ARG LAIKA_BUILD_COMMIT` into `ENV`; the deploy
      workflow passes `github.sha`.
- [ ] `laika version` and `laika --version` print the CLI version, checkout
      commit (with `+dirty`), protocol, node version and checkout path, and
      `--json`. No network.
- [ ] `laika doctor` (alias `laika status`) is read-only: node version, checkout
      state, local integration status against the board's compatibility
      answer, per-tool credential presence by file name only, hooks installed,
      `~/.laika/env` present. `--offline` skips the network; a board that
      answers `404` is reported as not supporting the check; exit codes 0 / 1 / 2.
      No token value is ever printed (test plants a token and greps output).
- [ ] SPEC §6.4 names the endpoint and §11.7 names both variables;
      `env-contract.test.ts` stays green.

## Named cross-area edits (D-033, D-034)

One PR, dispatched by the owner as one slice. Each crossing is named here:

- `server/**` (CORE): `src/version.ts`, `src/env.ts`, `src/index.ts`,
  `src/app.ts`, `src/http/routes/health.ts`, `src/http/routes/developer.ts`
  (new), `src/services/developer-compat.ts` (new), `src/protocol.ts` (new),
  their tests, `test/tooling/env-contract.test.ts` (`sampleFor` only),
  `test/tooling/structure.test.ts` (the `version.ts` exemption only).
- `cli/` (SHELL): `src/index.ts`, `src/version.ts`, `src/doctor.ts`,
  `src/protocol.ts` (new), `test/version.test.ts`, `test/doctor.test.ts` (new).
- `docker/Dockerfile` (SHELL): the `LAIKA_BUILD_COMMIT` `ARG`/`ENV`.
- `.github/workflows/deploy.yml` (not in the ownership table, `[ops]`): one
  `build-args` line.
- `docs/SPEC.md` (CHIEF): one §6.4 endpoint line and paragraph, two §11.7 rows.
