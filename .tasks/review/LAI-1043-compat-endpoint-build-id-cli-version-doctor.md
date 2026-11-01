---
id: LAI-1043
title: 'Developer access V3 slice A2: build identity, GET /developer/compatibility, the LAIKA_DEVELOPER_ACCESS flag, laika version and laika doctor'
area: server
assignee: polly
priority: p2
depends-on: []
started: 2026-11-01T20:48:22Z
finished: 2026-11-01T21:23:48Z
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
      by name, including `developer_access`), `cli` (`min_protocol_for`,
      `source { type, url, commit, path }`), and `release_notes` (`ref`,
      `whats_new`). SPEC §6.4 is the authority for the shape; the protocol
      range lives only in `protocol.*` (review fix (a)).
      It contains no secret, token, email, path on disk or database value; a
      test asserts the server secret and a minted token's value never appear.
- [x] The route reads no data (no database, no actor). Before first-boot
      setup it answers `409` (`conflict`, `details.setup_required: true`), like
      every API path but `/health` and `/setup`, and SPEC §6.4 says so; a
      db-backed route test and the built-server boot test pin it. *(Reworded on
      review B3: the first wording claimed it bypassed the setup gate, which it
      never did.)* No `can()` call: CHIEF is recording "public deployment
      metadata" (`/health`, this) as a CLAUDE.md §5 case in a separate PR.
- [x] Docker build takes `ARG LAIKA_BUILD_COMMIT` into `ENV`; the deploy
      workflow passes `github.sha`.
- [x] `laika version` and `laika --version` print the CLI version, checkout
      commit (with `+dirty`), protocol, node version and checkout path, and
      `--json`. No network.
- [x] `laika doctor` (alias `laika status`) is read-only: node version, checkout
      state, local integration status against the board's compatibility
      answer, per-tool credential presence by file name only, hooks installed,
      `~/.laika/env` present. `--offline` skips the network; a board that
      answers `404` is reported as not supporting the check, and a `409` is
      "not set up" only with `details.setup_required: true`; exit codes 0 / 1 /
      2, and 64 for a usage error. No token value is ever printed (test plants
      a token and greps output), and a board URL is printed only without its
      user, password, query or fragment; one carrying any of them is ACTION
      and is never fetched (review B1).
- [x] SPEC §6.4 names the endpoint and §11.7 names all three variables;
      `env-contract.test.ts` stays green, and asserts the Dockerfile's
      `ARG`/`ENV` and the deploy workflow's `build-args`. `build.test.ts` fails
      if `index.ts` stops passing any of the three to `createApp`.

## Named cross-area edits (D-033, D-034)

One PR, dispatched by the owner as one slice. Each crossing is named here:

- `server/**` (CORE): `src/env.ts`, `src/index.ts`, `src/app.ts`,
  `src/http/routes/health.ts`, `src/http/routes/developer.ts` (new),
  `src/services/developer-compat.ts` (new), `test/env.test.ts`,
  `test/http/routes/developer.test.ts` (new),
  `test/services/developer-compat.test.ts` (new), one `UNPAIRED` entry
  (`CompatibilityBody`) in `test/tooling/response-type-coverage.test.ts`, the
  LAI-1043 cases in `test/tooling/build.test.ts`, and the Dockerfile/deploy
  assertions in `test/tooling/env-contract.test.ts`.
- `server/web/src/api/health.ts` (SHELL): one field, `build_commit`, on the
  `Health` client type, which `view-type-drift.test.ts` pairs with the
  server's `HealthBody`.
- `server/web/test/api/endpoint-coverage.test.ts` (SHELL): one
  `NO_BROWSER_CALLER` entry for `api/v1/developer/compatibility`. Its only
  caller is `laika doctor` until the V3 screens exist. Found by CI on the
  first run of PR #200.
- `cli/` (SHELL): `src/index.ts`, `src/version.ts` (new), `src/doctor.ts`
  (new), `src/protocol.ts` (new), `test/version.test.ts` (new),
  `test/doctor.test.ts` (new).
- `docker/Dockerfile` (SHELL): the `LAIKA_BUILD_COMMIT` `ARG`/`ENV`.
- `.github/workflows/deploy.yml` (not in the ownership table, `[ops]`): one
  `build-args` line.
- `docs/SPEC.md` (CHIEF): one §6.4 endpoint line and paragraph, two §11.7 rows.

## Notes at review

- **Planned before, not done:** `server/src/protocol.ts` (the protocol lives
  in `services/developer-compat.ts`) and an edit to `structure.test.ts`
  (`version.ts` is unchanged). `env-contract.test.ts` needed none for the
  variables, which are read before any is judged; it gained the Dockerfile
  and deploy assertions on review.
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
  that as *"has not been set up yet"*. Kept on review (B3).
- No `Planned — LAI-10xx` SPEC mark was added, so LAI-1002 did not matter.

## Review round 1 (PR #200) — what changed

- B1: `cli/src/doctor.ts` `displayUrl()` / `urlProblem()`. Every printed URL
  is stripped of user, password, query and fragment. A credentialled board URL
  (any of the four sources or `--board`) is ACTION *"LAIKA_URL carries
  credentials"* and is not fetched; a credentialled URL in an agent's file is
  ACTION and the credential is not sent.
- B2: `LAIKA_CLI_SOURCE_URL` also refuses a query or fragment.
- B3: 409 kept. SPEC §6.4 now says so; the route test and the boot test pin
  it; doctor reads 409 as "not set up" only with `details.setup_required`.
- (a) `cli.min_protocol` / `cli.target_protocol` dropped; SPEC is the
  authority. (b) Boot test and Dockerfile/deploy assertions. (c) Doctor usage
  errors exit 64. (d) The "fresh copy" test now says what it guards.
