---
id: LAI-096
title: What else does NODE_ENV=test weaken?
area: server
assignee: builder-a
priority: p1
depends-on: [LAI-090]
discovered-from: LAI-090
finished: 2026-08-24T20:36:17Z
reviewed: 2026-08-25T18:00:00+05:30
started: 2026-08-24T20:28:14Z
status: done
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

---

## Review notes — PM, 2026-08-25T18:00:00+05:30

**The substance is accepted in full. One fix, and it is timing, not reasoning.**

- [x] **`environment-posture.test.ts` is load-sensitive and has no explicit
      timeout.** It failed for me in the full suite —
      *"leaves exactly one difference, and it is the one that is written down"*,
      **timed out in 5000ms after 5135ms**. Run alone it passes 13/13, with and
      without a raised timeout. It spawns child processes per environment, so
      under a parallel run on a busier machine it crosses vitest's 5s default.

Give it an explicit timeout generous enough that it fails for a *real* reason or
not at all, and say in a comment why it needs one — future readers should know
the cost is child processes, not a slow assertion.

**Why this is worth a send-back on otherwise exemplary work.** A gate that passes
on your machine and fails on mine is the one kind of failure that trains people
to re-run instead of read. This whole task exists because a check was silently
not doing its job; a check that is *noisily* unreliable erodes trust in the suite
just as fast, and faster in a repo where three sessions each run it.

**Everything else stands, and several parts are better than what I asked for.**

**Measuring the resolved context rather than reading the source** is the right
method, and using `auth.$context` rather than the options we pass is the
distinction that matters — asserting our own input would have proved only that we
passed it, and kept passing if a default flipped. That is the LAI-048 tautology
and you refused to ship it twice.

**The runtime-closure scan is the part that answers the actual question.** Pinning
known holes was the easy half; my point was that we could not *see* them. Scanning
the 28 packages the shipped process loads rather than the 139 in `node_modules`
is the right boundary, and **proving it by appending a `NODE_ENV` branch to
`ulid`'s dist** is the only way to know a scanner works. Failing in both
directions so the list cannot rot is what stops it becoming decoration.

**Failing the suite on a reason matching "only a test convenience"** is a good
call. I said it was not an acceptable reason; leaving that to judgement would
have been optimistic, given it is exactly what the origin check was.

**Two findings wider than I scoped:**
- **`isTest()` also reads `TEST`**, so a stray `TEST=1` disables the CSRF check
  **in production**. The trigger was never only `NODE_ENV`.
- **The fixed localhost IP under test *and* development** — recorded with the
  condition that would make it unsafe, rather than dismissed as harmless today.

**Not pinning better-auth's rate limiter on is right**, and the justification is
load-bearing rather than convenient: it keys on an IP the same library fixes
outside production, so it would be a second limiter doing nothing exactly where
it appeared to be new. Asserting our own limiter covers `/api/v1/auth/*` means
the justification fails with it.

**Three tests now fail when the origin check is relaxed. Before LAI-090 it failed
none** — which was the whole problem.


---

## Builder-A — send-back addressed (2026-08-24T20:43:25Z)

**Fixed by removing the timing sensitivity, not by raising the number.** A bigger
timeout on the same five spawns would still have been a gate whose result
depended on how busy the machine was; it would just have flaked less often, which
is worse, because a rare flake is the kind people re-run past.

Three changes:

1. **Two spawns instead of five.** Every measurement now happens once in
   `beforeAll` and the tests read the result. They perform no I/O at all, so they
   cannot time out for a reason that is not about the assertion.
2. **`tsx` directly rather than through `npx`.** Measured over three runs each:
   `npx tsx` 0.73-1.05s per spawn, the binary 0.52-0.92s. Not micro-optimisation
   — spawn cost is the entire runtime of that block.
3. **An explicit `SPAWN_BUDGET_MS = 60_000` on the hook**, with a comment saying
   the cost is process spawns rather than a slow assertion, and that a trip means
   something is genuinely wrong with the child process.

### Reproduced the failure condition rather than assuming it was gone

Saturated all 10 cores with busy loops and ran it under that load:

- the file alone: **13/13, 2.44s of test time against a 60s budget** — a 24x margin;
- the full parallel suite under the same load: **860 passed**.

Three consecutive unloaded full-suite runs also pass. Previously the block spent
about 4s of spawning against vitest's 5s default, which is why it passed alone
and failed at 5135ms in a parallel run.

860 server tests pass; lint, format and typecheck clean.

## Review — PM, 2026-08-25

**Accepted. You fixed the cause, not the symptom, and said why** — a bigger
timeout on the same five spawns would still have been a gate whose result
depended on machine load, just flaking rarely enough that people re-run past it.
Measuring once in `beforeAll` means the tests do no I/O and cannot time out for a
reason that is not the assertion.

**I reproduced my own bounce condition rather than trusting the fix.** Saturated
all 10 cores with busy loops and ran the **full** suite: **873 passed, exit 0**.
The file alone is 2.44s against a 60s budget.

Dropping `npx` for `tsx` after measuring that spawn cost was the entire runtime
is the right order — measure, then optimise.

Everything from the first review stands: the resolved-context method, the
runtime-closure scan proved by patching `ulid`'s dist, the derived needles, and
failing the suite on *"only a test convenience"*.
