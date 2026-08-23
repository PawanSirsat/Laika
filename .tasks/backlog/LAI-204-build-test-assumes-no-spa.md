---
id: LAI-204
title: build.test.ts fails once the SPA is actually built
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-017
status: backlog
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

- [ ] `pnpm test` passes both with and without `server/public/` present. Run it
      both ways — that is the whole point of this task.
- [ ] The fallback assertion controls its own precondition rather than assuming
      one: move `public/` aside for the duration, point the server at a
      temporary empty public dir, or assert on a case the build cannot change.
- [ ] If the built-SPA path is also worth asserting, it is a **separate**
      explicit case — "serves the SPA when built" and "serves the fallback when
      not" are two behaviours, and collapsing them into one assertion is what
      caused this.
- [ ] No change to `server/public/` semantics: it stays build output, fully
      gitignored, nothing committed into it (LAI-016).

## Notes / context

Discovered running the pre-review gate for LAI-017. **Not caused by LAI-017** —
the test would have failed for anyone who ran `pnpm build` after LAI-024 landed
the server build; the SPA just makes it deterministic.

`server/test/` is Builder-A's area, so LAI-017 does not touch it and ships with
`pnpm test` red on this one case. Everything else is green: `pnpm format`,
`pnpm lint`, `pnpm typecheck`, `pnpm build`, and the other 249 tests.

No new dependencies.
