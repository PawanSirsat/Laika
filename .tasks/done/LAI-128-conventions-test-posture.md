---
id: LAI-128
title: CONVENTIONS §4 should say the test environment must not be weaker than production
area: docs
assignee: unclaimed
priority: p3
depends-on: [LAI-096]
discovered-from: LAI-096
status: done
---

## Goal

LAI-096 AC5 asks for the findings in `docs/CONVENTIONS.md` §4. **`docs/` is PM's**,
so it travels here. The code and the tests are done and merged-ready; this is the
paragraph that makes it a property of how we test rather than a one-off fix.

## What to say

**The test environment must not be weaker than production.** A relaxation that
only applies under `NODE_ENV=test` is invisible by construction: a check that
cannot fail is indistinguishable from a check that passes. `better-auth` switched
its CSRF origin check off under test, and the bug that locked the owner out of
their own instance (LAI-090) could not have been caught by any test at any level.

Three rules that follow, all now enforced by
`server/test/tooling/environment-posture.test.ts`:

1. **Read dependencies for `isTest` / `NODE_ENV`, not their docs.** The
   better-auth default was undocumented and only visible in
   `dist/context/create-context.mjs`.
2. **Pin the security-relevant ones explicitly**, so a version bump that changes
   a default fails rather than passing quietly. Assert the **resolved**
   configuration (better-auth exposes `auth.$context`), never the options we pass
   in — asserting our own input is the tautology LAI-048 shipped once already.
3. **"It is only a test convenience" is not a reason.** That is exactly what the
   origin check was. A difference either gets pinned or gets a written reason
   somebody can disagree with.

Worth recording the measured result, since it is the useful artefact:

| | development | production | test |
| --- | --- | --- | --- |
| `skipOriginCheck` | false | false | false |
| `skipCSRFCheck` | false | false | false |
| foreign origin trusted | no | no | no |
| better-auth rate limiting | **off** | **on** | **off** |

The one remaining difference is better-auth's own limiter, which is safe because
`http/middleware/rate-limit.ts` covers the same paths in every environment — and
that is asserted rather than asserted-about.

## Notes / context

The general lesson is now the fifth instance in this repo and probably deserves a
line of its own: **a guard that cannot fail is not a guard.** LAI-054 (a test glob
matching nothing), LAI-048 (a constant compared to itself), LAI-074 (CSS matching
no element), LAI-090 (a security check off in the only environment we measure),
and the two probes in LAI-084 that stayed green because the code they targeted
could not execute.

## Done — PM, 2026-08-25

CONVENTIONS §4 now carries the measured posture table, the one allowed difference
with its reason, the rule that `"only a test convenience"` fails the suite, and
the runtime-closure scan.

It also records the general lesson with all five instances, because that is the
part that generalises: **a guard that cannot fail is indistinguishable from one
that works**, and every instance was found by *attacking* the guard rather than
reading it.
