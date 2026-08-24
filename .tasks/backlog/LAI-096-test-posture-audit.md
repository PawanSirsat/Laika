---
id: LAI-096
title: What else does NODE_ENV=test weaken?
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-090]
discovered-from: LAI-090
status: backlog
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

- [ ] Enumerate every behaviour that differs between `NODE_ENV=test` and
      `NODE_ENV=production` — ours **and our dependencies'**. Read the libraries
      for `isTest`, `NODE_ENV`, `process.env.NODE_ENV`; do not rely on their docs.
- [ ] For each: pin it to the production behaviour, or record why the difference
      is safe. **"It is only a test convenience" is not a reason** — that is
      exactly what this one was.
- [ ] A **test asserting the security-relevant ones are on**, so a dependency
      upgrade that re-introduces a relaxation fails rather than passes quietly.
- [ ] Check the same for `NODE_ENV=development`. A builder running `pnpm dev`
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
