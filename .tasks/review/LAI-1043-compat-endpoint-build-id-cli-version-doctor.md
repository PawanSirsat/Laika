---
id: LAI-1043
title: 'Developer access V3 slice A2: build identity, GET /developer/compatibility, the LAIKA_DEVELOPER_ACCESS flag, laika version and laika doctor'
area: server
assignee: polly
priority: p2
depends-on: []
started: 2026-11-01T20:48:22Z
finished: 2026-11-01T21:00:57Z
discovered-from: LAI-1042
status: review
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

- [x] `LAIKA_BUILD_COMMIT` is read by `readEnv`: unset or empty is `null`, a
      7–40 character lowercase hex string is kept, anything else fails boot with
      an `EnvError` naming the variable.
- [x] `GET /api/v1/health` keeps `status`, `version` and `uptime_ms` unchanged
      and adds `build_commit` (string or `null`). Old clients that read only the
      three fields are unaffected.
- [x] `LAIKA_DEVELOPER_ACCESS` is read by `readEnv`: unset or empty is
      `classic`; `classic`, `preview`, `v3` are accepted; anything else fails boot
      with an `EnvError` that names the variable and the three values.
- [x] `GET /api/v1/developer/compatibility` answers `200` anonymously and
      authenticated with the same body: `server` (version, build commit),
      `protocol` (current, min client), `features` (the closed key set, asserted
      by name, including `developer_access`), `cli` (source url, commit, path,
      the minimum protocol per feature, `whats_new`), and `release_notes`.
      It contains no secret, token, email, path on disk or database value; a
      test asserts the server secret and a minted token's value never appear.
- [x] The route reads no data (no database, no actor) and is mounted before the
      setup gate's refusal applies, like `/health`. Its `can()` position is
      recorded in the PR: it is the health shape, not a third §5 exception.
- [x] Docker build takes `ARG LAIKA_BUILD_COMMIT` into `ENV`; the deploy
      workflow passes `github.sha`.
- [x] `laika version` and `laika --version` print the CLI version, checkout
      commit (with `+dirty`), protocol, node version and checkout path, and
      `--json`. No network.
- [x] `laika doctor` (alias `laika status`) is read-only: node version, checkout
      state, local integration status against the board's compatibility
      answer, per-tool credential presence by file name only, hooks installed,
      `~/.laika/env` present. `--offline` skips the network; a board that
      answers `404` is reported as not supporting the check; exit codes 0 / 1 / 2.
      No token value is ever printed (test plants a token and greps output).
- [x] SPEC §6.4 names the endpoint and §11.7 names both variables;
      `env-contract.test.ts` stays green.

## Named cross-area edits (D-033, D-034)

One PR, dispatched by the owner as one slice. Each crossing is named here:

- `server/**` (CORE): `src/env.ts`, `src/index.ts`, `src/app.ts`,
  `src/http/routes/health.ts`, `src/http/routes/developer.ts` (new),
  `src/services/developer-compat.ts` (new), `test/env.test.ts`,
  `test/http/routes/developer.test.ts` (new),
  `test/services/developer-compat.test.ts` (new), and one `UNPAIRED` entry
  (`CompatibilityBody`) in `test/tooling/response-type-coverage.test.ts`.
- `server/web/src/api/health.ts` (SHELL): one field, `build_commit`, on the
  `Health` client type, which `view-type-drift.test.ts` pairs with the
  server's `HealthBody`.
- `cli/` (SHELL): `src/index.ts`, `src/version.ts` (new), `src/doctor.ts`
  (new), `src/protocol.ts` (new), `test/version.test.ts` (new),
  `test/doctor.test.ts` (new).
- `docker/Dockerfile` (SHELL): the `LAIKA_BUILD_COMMIT` `ARG`/`ENV`.
- `.github/workflows/deploy.yml` (not in the ownership table, `[ops]`): one
  `build-args` line.
- `docs/SPEC.md` (CHIEF): one §6.4 endpoint line and paragraph, two §11.7 rows.

## Notes at review

- **Planned before, not done:** `server/src/protocol.ts` (the protocol lives
  in `services/developer-compat.ts`), and edits to `env-contract.test.ts` and
  `structure.test.ts`. Neither test needed one: the three variables are read
  before any is judged, as the checkpoint windows are, and `version.ts` is
  unchanged.
- **One more variable than the brief named:** `LAIKA_CLI_SOURCE_URL` (default
  this repository), so a self-hosted board can point helpers at its own fork.
  It is `https://` only and refused at boot with a user or password in it,
  because it is served to anyone.
- **Every V3 feature is `false`** and the protocol is `1`: nothing behind
  protocol 2 exists yet, so saying `true` would be untrue.
- **`can()`:** the route reads no data and no actor. It has the same shape as
  `/health`, which has no `can()` either. CHIEF to rule on whether CLAUDE.md
  §5 should name public deployment metadata (`/health`, this) as a case.
- **The setup gate still applies**: before first boot the endpoint answers
  `409` like every API path but `/health` and `/setup`. `laika doctor` reports
  that as *"has not been set up yet"*.
- No `Planned — LAI-10xx` SPEC mark was added, so LAI-1002 did not matter.
