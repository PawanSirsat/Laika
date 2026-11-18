---
id: LAI-1332
title: 'Image build commit from the deploy itself (Coolify SOURCE_COMMIT), so auto-deploys report the right commit'
area: docker
assignee: build-1332
priority: p2
depends-on: []
status: in-progress
started: 2026-11-18T11:39:52Z
---

## Goal

Owner, 2026-11-18: Ksage now auto-deploys on every push to KvellDynamics/ksage-2.0 `laika`. CHIEF
switched Coolify's Auto Deploy on, and turned on "Include source commit in build", so Coolify
passes `SOURCE_COMMIT` as a Docker build arg.

The image takes its build commit only from the `LAIKA_BUILD_COMMIT` build arg (`docker/Dockerfile`,
runtime stage). On Ksage that value was set by hand before each manual deploy, so an auto-deploy
would report a stale commit on `/health` and `/developer/compatibility` — and the CLI's source
commit comes from it (§6.4, LAI-1043).

Board card: LAIKA-1138 (`external_ref` LAI-1332). Filed and dispatched by CHIEF.

## Change

`docker/Dockerfile`, runtime stage:

```
ARG LAIKA_BUILD_COMMIT=""
ARG SOURCE_COMMIT=""
ENV LAIKA_BUILD_COMMIT=${LAIKA_BUILD_COMMIT:-$SOURCE_COMMIT}
```

GitHub Actions keeps passing `LAIKA_BUILD_COMMIT=${{ github.sha }}`, which wins. Coolify's
`SOURCE_COMMIT` fills it otherwise.

## Named crossings (D-033, D-034)

- `docs/SPEC.md` §11.7, the `LAIKA_BUILD_COMMIT` row only: both sources and their precedence.
- `server/test/tooling/env-contract.test.ts`, the `env contract: the image knows its own commit
  (LAI-1043)` block only: the assertion that pins the Dockerfile's `ENV` line.

## Acceptance criteria

- [ ] `docker/Dockerfile`'s runtime stage declares `ARG SOURCE_COMMIT=""` and sets
      `ENV LAIKA_BUILD_COMMIT=${LAIKA_BUILD_COMMIT:-$SOURCE_COMMIT}`; nothing else in the file changes
      but the comment above those lines.
- [ ] A Docker build with only `--build-arg SOURCE_COMMIT=abc` bakes `LAIKA_BUILD_COMMIT=abc`; with
      `LAIKA_BUILD_COMMIT=def` and `SOURCE_COMMIT=abc` it bakes `def`; with neither it bakes empty.
      Proved with real builds and `docker inspect`, or the log says plainly that docker could not run.
- [ ] `.github/workflows/deploy.yml` is unchanged: CI's AWS build still passes `github.sha` as
      `LAIKA_BUILD_COMMIT`, and the existing assertion on it still holds.
- [ ] `env-contract.test.ts` pins the new `ARG` and `ENV` lines, and goes red if the fallback is
      removed or the precedence is reversed.
- [ ] SPEC §11.7's `LAIKA_BUILD_COMMIT` row names both build args and which wins. `SOURCE_COMMIT`
      gets no row of its own: it is a build arg, never read by the server, and the §11.7 table is
      the server's runtime contract.
- [ ] The changed test file passes on its own; `pnpm lint` and `pnpm format` pass on the changed
      files. Each exit code is recorded.

## Out of scope

- Coolify settings. After this reaches Ksage, CHIEF deletes the hand-set `LAIKA_BUILD_COMMIT` from
  Ksage Backend: it is also a runtime env, so it would override the image's value.
