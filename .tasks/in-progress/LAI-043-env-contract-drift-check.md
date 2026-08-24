---
id: LAI-043
title: Nothing catches env-contract drift between the server and the container
area: server
assignee: builder-a
priority: p2
depends-on: []
discovered-from: LAI-033
status: in-progress
started: 2026-08-24T07:06:25+05:30
---

## Goal

`docker compose up` was broken for about 35 minutes today and **no part of the
gate could have caught it**. LAI-032 made `LAIKA_PUBLIC_URL` required in
production; `docker-compose.yml` had never set it. `pnpm test` does not build the
image, and the docker build is not in CI, so the whole suite stayed green while
the container could not boot.

It surfaced only because PM happened to run the container's environment by hand
during an unrelated review. That is luck, not a process.

## Acceptance criteria

- [ ] A check that fails when the server and the container disagree about the
      environment, in **both** directions:
      - a variable the server requires that `docker-compose.yml` does not set;
      - a variable compose sets that the server never reads.
- [ ] It reads the real sources — `server/src/env.ts` and
      `docker/docker-compose.yml` — rather than a hand-maintained list that will
      drift the same way.
- [ ] Runs as part of `pnpm test`.
- [ ] **Confirmed able to fail**: remove `LAIKA_PUBLIC_URL` from compose, watch
      it go red, put it back. That is the exact regression this exists for.
- [ ] The failure message names the variable and the direction.

## Notes / context

**Prefer this over putting the docker build in the gate.** Building an image on
every test run is slow and needs Docker present; this check is a file read and
catches the specific class that actually bit us. If the build later joins CI,
this stays useful — it fails in seconds rather than minutes.

`docker/` is Builder-B's and `server/` is Builder-A's (D-016), so **the check
reads across an ownership boundary**. Reading is fine; the test belongs in
`server/test/tooling/` with the other cross-cutting checks, and it must not
*edit* anything under `docker/`. If it needs a change there, file a task.

Three env variables are already known-drifted in the other direction:
`LAIKA_DISABLE_INVITE_ONLY` is in SPEC §11.7 and read by nothing (LAI-105).
Expect the first run to find things; seed an exemption list with reasons rather
than forcing them all fixed in this task.

No new dependencies.
