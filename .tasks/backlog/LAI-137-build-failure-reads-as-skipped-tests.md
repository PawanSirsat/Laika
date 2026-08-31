---
id: LAI-137
title: A failing build reports as "12 skipped", which reads like nothing went wrong
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-045
status: backlog
---

## Goal

`server/test/tooling/build.test.ts` runs `pnpm run build` in a `beforeAll`. When
the build fails, vitest reports a **failed suite** — and the summary line that a
reader actually looks at says:

```
 Test Files  1 failed | 59 passed (60)
      Tests  1068 passed | 12 skipped (1080)
```

**Zero tests failed.** The count of failures is zero, twelve tests are "skipped",
and the thing that actually broke — the build does not compile — appears only if
you scroll into the suite error. Measured during LAI-045: a
`table as Record<string, unknown>` cast passed `tsconfig.json` and failed
`tsconfig.build.json`, and this is how it surfaced.

Two separate problems, and the second is the real one:

1. **`build.test.ts` is a genuinely different gate from `pnpm typecheck`** — it
   compiles under `tsconfig.build.json`, which `typecheck` never uses. That is
   valuable and nothing else covers it.
2. **Its failure mode is illegible.** "1068 passed, 12 skipped" is the shape of a
   healthy run with some conditional tests, not of a broken build. A builder
   scanning that line — or a reviewer taking a builder's word for it — can
   reasonably read it as fine.

A gate whose failure is indistinguishable from a normal skip is a gate people
learn to scroll past.

## Acceptance criteria

- [ ] A failing build fails in a way whose **summary line** says the build broke.
      A failing assertion, a suite name that reads as a build failure, or moving
      the build out of `beforeAll` — implementer's call, argued in the log.
- [ ] **Prove it.** Break the build deliberately (a type error under
      `tsconfig.build.json` only, as LAI-045 hit), capture the output a reader
      sees, and put it in the log beside the current "12 skipped" output. Then
      revert. The comparison is the deliverable.
- [ ] The build is still only run **once** per suite run — it is the slowest
      thing in the suite and must not become per-test.
- [ ] The distinction from `pnpm typecheck` is written down where the next
      person meets it, so nobody "simplifies" this away as a duplicate of
      typecheck. It is not one: it uses a different tsconfig.
- [ ] `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
      all green.

## Notes / context

No new dependencies.

Related but **not** a duplicate of LAI-204 (`build.test.ts` assumes no SPA),
which is about what the test asserts. This is about how it reports when the
build step itself fails. Checked before filing.

Lower priority than LAI-136: this one is misleading, that one is a suite that
cannot see a whole class of error at all. Both were filed at CHIEF's explicit
request during the LAI-414 review, separately so one can be closed rather than
either lost. Sequencing is CHIEF's.
