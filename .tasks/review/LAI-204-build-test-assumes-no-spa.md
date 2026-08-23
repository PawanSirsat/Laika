---
id: LAI-204
title: build.test.ts fails once the SPA is actually built
area: server
assignee: builder-a
priority: p1
depends-on: []
discovered-from: LAI-017
status: review
started: 2026-08-24T04:53:31+05:30
finished: 2026-08-24T04:57:26+05:30
---

## Goal

`server/test/tooling/build.test.ts:100` asserts the SPA fallback:

```ts
expect(await spa.text()).toContain('Laika is running.');
```

That string comes from `src/static/fallback.html`, which the server serves only
when `server/public/index.html` is **absent** (LAI-016). LAI-017 now builds a
real SPA into `server/public/`, so the server correctly serves that instead and
the assertion fails.

The server is not wrong and the SPA is not wrong — the test is asserting a
precondition it does not control.

**The deeper problem is that the test is state-dependent on a gitignored
directory.** Proven by running it both ways on the same commit:

| `server/public/` | Result |
| --- | --- |
| absent (clean clone) | `Tests  6 passed (6)` |
| present (after `pnpm build`) | `Tests  1 failed \| 5 passed (6)` |

So CI passes and a developer who has run `pnpm build` fails, on identical
source. That is worse than the assertion being wrong: it is a test whose outcome
depends on untracked local state, which is exactly the failure mode LAI-016 was
filed to prevent for the fallback in the first place.

## Acceptance criteria

- [x] `pnpm test` passes both with and without `server/public/` present. Run it
      both ways — that is the whole point of this task.
- [x] The fallback assertion controls its own precondition rather than assuming
      one: move `public/` aside for the duration, point the server at a
      temporary empty public dir, or assert on a case the build cannot change.
- [x] If the built-SPA path is also worth asserting, it is a **separate**
      explicit case — "serves the SPA when built" and "serves the fallback when
      not" are two behaviours, and collapsing them into one assertion is what
      caused this.
- [x] No change to `server/public/` semantics: it stays build output, fully
      gitignored, nothing committed into it (LAI-016).

## Notes / context

Discovered running the pre-review gate for LAI-017. **Not caused by LAI-017** —
the test would have failed for anyone who ran `pnpm build` after LAI-024 landed
the server build; the SPA just makes it deterministic.

`server/test/` is Builder-A's area, so LAI-017 does not touch it and ships with
`pnpm test` red on this one case. Everything else is green: `pnpm format`,
`pnpm lint`, `pnpm typecheck`, `pnpm build`, and the other 249 tests.

No new dependencies.

---

## Notes at review — builder-a

**Reproduced before fixing, and verified both ways after.** The report was exactly
right, including the diagnosis.

```
                                    before          after
server/public/ absent   →   6 passed          →  278 passed
server/public/ present  →   1 failed, 5 pass  →  278 passed
```

Both runs on the same commit, same source, `pnpm test` in full. AC1 asks for the
suite to be run both ways rather than reasoned about, so it was.

**1. The fix is `LAIKA_PUBLIC_DIR`, a new env var.** The build test spawns a real
process, so it could not use the in-process `publicDir` injection the unit tests
have. Rather than move the developer's `public/` aside — destructive, racy, and
it loses their build output if the test crashes — the server now accepts an
override and each case points it at a temp directory it created. The test states
its precondition instead of inheriting one.

The variable earns its place beyond the test: it lets a deployment serve the SPA
from somewhere other than `server/public`, which is a reasonable thing to want
and costs four lines. Defaults to `undefined`, so behaviour is unchanged when it
is unset.

**2. Split into two named cases, per AC3.** "serves the committed fallback when no
SPA has been built" (empty temp dir) and "serves the built SPA instead when one is
present" (temp dir containing an `index.html`). Collapsing those into one
assertion is precisely what made the original state-dependent — the test could
not tell which behaviour it was looking at, so it asserted whichever one the
machine happened to be in.

The fallback case still proves what the original was for: that
`dist/static/fallback.html` shipped, which is the asset `tsc` does not copy.

**3. `server/public/` semantics unchanged** (AC4). Still build output, still fully
gitignored, still nothing committed into it. The LAI-016 test asserting
`git ls-files -- server/public` is empty is untouched and still passes.

**4. Good catch, and the framing was the useful part.** "A test whose outcome
depends on untracked local state" is a sharper description than "the assertion is
wrong", and it is what made the fix obvious rather than a matter of picking a
different string to match on. It is also the same failure mode LAI-016 was filed
to prevent, arriving from the other direction — worth noticing that it took
someone outside `server/` to see it.

**Note for whoever reviews LAI-017:** with this merged, `pnpm test` is green with
the SPA built. Its "ships with `pnpm test` red on this one case" caveat no longer
applies.
