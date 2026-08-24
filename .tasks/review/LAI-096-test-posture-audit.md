---
id: LAI-096
title: What else does NODE_ENV=test weaken?
area: server
assignee: builder-a
priority: p1
depends-on: [LAI-090]
discovered-from: LAI-090
finished: 2026-08-24T20:36:17Z
started: 2026-08-24T20:28:14Z
status: review
---

## Goal

LAI-090 found that **better-auth disables its origin check under
`NODE_ENV=test`**, which vitest sets. The suite ran with a weaker security
posture than production and **no test at any level could have caught the bug** —
every request was accepted regardless of `Origin`.

It was found by accident: an acceptance test returned 200 for
`https://evil.example` and Builder-A could not explain why.

**The specific hole is pinned. The question this raises is not.** better-auth is
one library among several, and "relax under test" is a common convenience. **Any
other instance of it is a hole we cannot see, by construction** — a test that
cannot fail is indistinguishable from a test that passes.

## Acceptance criteria

- [x] Enumerate every behaviour that differs between `NODE_ENV=test` and
      `NODE_ENV=production` — ours **and our dependencies'**. Read the libraries
      for `isTest`, `NODE_ENV`, `process.env.NODE_ENV`; do not rely on their docs.
- [x] For each: pin it to the production behaviour, or record why the difference
      is safe. **"It is only a test convenience" is not a reason** — that is
      exactly what this one was.
- [x] A **test asserting the security-relevant ones are on**, so a dependency
      upgrade that re-introduces a relaxation fails rather than passes quietly.
- [x] Check the same for `NODE_ENV=development`. A builder running `pnpm dev`
      should not be exercising a different product from the one that ships.
- [ ] Record the findings in `docs/CONVENTIONS.md` §4 — this is a property of how
      we test, not a one-off fix.

## Notes / context

**Start with anything touching auth, sessions, cookies, CSRF or rate limiting.**
Those are where a silent relaxation costs most, and where "it works in tests" is
most misleading.

The general lesson, now the fourth time in this repo: **a guard that cannot fail
is not a guard.** LAI-054 (a test glob matching nothing), LAI-048 (a constant
compared to itself), LAI-074 (CSS matching no element), and now a security check
switched off in the only environment we ever measure.


---

## Builder-A notes (2026-08-25)

### The measured answer

Not read off the source — the probe builds a real `auth` instance in a child
process under each `NODE_ENV` and prints better-auth's **resolved** context:

| | development | production | test |
| --- | --- | --- | --- |
| `skipOriginCheck` | false | false | false |
| `skipCSRFCheck` | false | false | false |
| foreign origin trusted | no | no | no |
| loopback trusted (LAI-090) | yes | yes | yes |
| better-auth rate limiting | **off** | **on** | **off** |

**One difference survives**, and it is written down with a reason rather than
excused. A child process is the only honest way to measure this:
`@better-auth/core` captures `NODE_ENV` into a module-level constant at import,
so a test that reassigned `process.env.NODE_ENV` would pass while measuring the
environment vitest set.

### Seven differences found, one pinned, six reasoned

The full table is `DIFFERENCES` in the test, each with a trigger, a verdict and a
reason. The ones worth naming here:

- **origin check** — *pinned* (LAI-090). Trigger is wider than the task assumed:
  `isTest()` is `NODE_ENV === 'test' || toBoolean(env.TEST)`, so **a stray
  `TEST=1` disables CSRF in production**. Pinning covers that too.
- **better-auth's rate limiting** — *safe*, because our own limiter runs in every
  environment and covers `/api/v1/auth/*`. That is asserted, not asserted-about:
  if `isLimited` ever stops covering those paths the justification fails with it.
- **client IP resolution** — `@better-auth/core` returns a fixed localhost IP
  under **test and development**. *Safe today* because nothing keys on it: our
  limiter deliberately shares one anonymous bucket, and `sessions.ip_address` is
  written and read by nothing. It becomes load-bearing the day either changes,
  which is why it has a row rather than being dismissed.
- **default-secret refusal** — skipped under test, but `env.ts` requires
  `LAIKA_SECRET` in every environment (D-018), so better-auth never sees its own
  default. Dead code for us, not a relaxation.

### The part that answers "what else", rather than "what now"

Pinning the known holes is the easy half. The task's real point is that we could
not *see* them, so the last block re-scans the runtime closure — the 28 packages
the shipped process actually loads, not the 139 in `node_modules`, most of which
are vitest and esbuild and never run — and fails when a package **starts**
branching on the environment.

Proved by simulating a dependency upgrade: appending a `NODE_ENV` branch to
`ulid`'s dist made the suite fail with *"a runtime dependency started branching
on NODE_ENV — read it and add it to DIFFERENCES: expected [ 'ulid' ]"*. It also
fails in the other direction, so the list cannot rot into a place where stale
entries hide new ones.

### Two guards against this file becoming decoration

- every difference must carry a trigger and a reason of real length;
- the word-shaped excuse is banned outright — a reason matching *"only a test
  convenience"* fails the suite. That is precisely what the origin check was.

### Verification

Six probes plus the simulated upgrade, all seven fail when broken. Relaxing the
origin check under test now fails **three** tests; before LAI-090 it failed none,
which is the whole point.

860 server tests pass. AC5 (`docs/CONVENTIONS.md`) travelled to **LAI-128** —
`docs/` is PM's — with the measured table so it can be lifted rather than
reconstructed.
