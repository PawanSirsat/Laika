---
id: LAI-043
title: Nothing catches env-contract drift between the server and the container
area: server
assignee: builder-a
priority: p2
depends-on: []
discovered-from: LAI-033
status: done
started: 2026-08-24T07:06:25+05:30
finished: 2026-08-24T07:09:37+05:30
reviewed: 2026-08-24T08:15:00+05:30
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

- [x] A check that fails when the server and the container disagree about the
      environment, in **both** directions:
      - a variable the server requires that `docker-compose.yml` does not set;
      - a variable compose sets that the server never reads.
- [x] It reads the real sources — `server/src/env.ts` and
      `docker/docker-compose.yml` — rather than a hand-maintained list that will
      drift the same way.
- [x] Runs as part of `pnpm test`.
- [x] **Confirmed able to fail**: remove `LAIKA_PUBLIC_URL` from compose, watch
      it go red, put it back. That is the exact regression this exists for.
- [x] The failure message names the variable and the direction.

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

---

## Notes at review — builder-a

**322 tests**; format, lint and typecheck clean. `docker/` untouched — verified
with `git status docker/` after every probe.

**1. Both sides are discovered by running the code, not by parsing it.** This is
the part I would most like reviewed, because it is what stops the check drifting
the way the contract did:

- **What the server reads** — `readEnv` is handed a `Proxy` instead of
  `process.env`, which records every property access and returns a plausible
  value. A variable added to `env.ts` tomorrow is picked up the moment it is
  read; nobody has to remember this file exists.
- **What the server requires** — start from `{NODE_ENV: 'production'}`, call
  `readEnv`, and whatever the thrown `EnvError` names gets added and retried
  until it boots. The required set is therefore whatever the code *enforces*,
  including a rule written by someone who never opens this test.

A regex over `env.ts` would have been quicker and would have rotted the same way
the compose file did.

**2. Four probes, including the exact regression** (AC4):

| Probe | Result |
| --- | --- |
| remove `LAIKA_PUBLIC_URL` from compose — **the real outage** | fails, names it and the direction |
| add `LAIKA_NONSENSE` to compose | fails: "compose sets it and `env.ts` never reads it" |
| make a **new** variable required in `env.ts` | fails, names `LAIKA_SMTP_URL` — the forward-looking case |
| rename compose's `environment:` block | throws "has the file changed shape?" |

The third matters most: it is the same mistake as the outage, made in the other
direction, by a future task. The fourth is the one a check like this usually gets
wrong — a parser that finds nothing passes vacuously forever, so both parsers
throw rather than return empty.

**3. Nothing needed exempting.** `COMPOSE_ONLY_ALLOWED` is seeded empty: compose
sets five variables and the server reads all five. The task expected the first run
to find drift, and I would rather report that it found none than pad the list. The
list and its staleness guard stay for when it does.

`LAIKA_DISABLE_INVITE_ONLY` is not caught here, correctly — it is the SPEC↔server
gap (LAI-105), and compose does not set it, so no direction of this check applies.
A third check against §11.7's table would catch that class; worth a task if you
want it, but LAI-105 resolves the only current instance.

**4. Scope.** The check reads `docker/docker-compose.yml` and never writes it, and
lives in `server/test/tooling/` with the other cross-cutting checks, as the task
directed. If it ever needs a compose change, that is a task for Builder-B.

## Review — PM, 2026-08-24

**Accepted.** Gate green: lint clean, **322 server tests** (up from 317) and 90
web.

**I broke it in both directions myself:**

| Violation | Result |
| --- | --- |
| Remove `LAIKA_PUBLIC_URL` from compose — *the exact regression* | ✗ `sets, in compose, every variable the server requires in production` |
| Add `LAIKA_NONSENSE` compose sets and nothing reads | ✗ `sets nothing in compose that the server never reads` |

Restored, 5/5 green. **The failure that cost 35 minutes of a broken container now
takes milliseconds to catch.**

### The implementation is better than the task I wrote

I asked for a check that "reads the real sources… rather than a hand-maintained
list that will drift the same way". You went past that:

- **`discovers the required set by running readEnv, not by parsing it`** — the
  check *executes* the env reader instead of regex-matching its source. A parser
  would have drifted from the code the first time someone restructured `env.ts`,
  which is the same failure one level up.
- **`records reads through a Proxy, so a new variable needs no edit here`** — the
  set of required variables is observed, not declared. A new variable is covered
  the moment it is read, with no second place to remember.

That second property is what makes this durable. My version of the task would
have produced something correct today and stale in a month.

**`keeps the compose-only exemption list honest`** carries LAI-038's idea across —
the same guard against a list rotting into a bypass, applied to a different list.

**Boundaries respected exactly as specified.** The check reads
`docker/docker-compose.yml` and edits nothing there; it lives in
`server/test/tooling/` with the other cross-cutting checks. Reading across the
D-016 line, never writing.

**This closes the gap I opened.** LAI-032 made a variable required, compose never
set it, the whole suite stayed green, and it surfaced only because I happened to
run the container by hand. That class is now covered.
