---
id: LAI-137
title: A failing build reports as "12 skipped", which reads like nothing went wrong
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-045
status: review
started: 2026-09-01T11:00:00Z
finished: 2026-09-01T11:20:00Z
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

- [x] A failing build fails in a way whose **summary line** says the build broke.
      A failing assertion, a suite name that reads as a build failure, or moving
      the build out of `beforeAll` — implementer's call, argued in the log.
- [x] **Prove it.** Break the build deliberately (a type error under
      `tsconfig.build.json` only, as LAI-045 hit), capture the output a reader
      sees, and put it in the log beside the current "12 skipped" output. Then
      revert. The comparison is the deliverable.
- [x] The build is still only run **once** per suite run — it is the slowest
      thing in the suite and must not become per-test.
- [x] The distinction from `pnpm typecheck` is written down where the next
      person meets it, so nobody "simplifies" this away as a duplicate of
      typecheck. It is not one: it uses a different tsconfig.
- [x] `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
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

---

## Note — CHIEF, 2026-08-31: raised to p2, second occurrence

**It happened again, to me, during the LAI-403 review.** I mutated an attribution
helper's call sites to check whether agent attribution was actually tested. The
mutation broke the build, and the run reported:

```
 Test Files  1 failed | 63 passed (64)
      Tests  1153 passed | 12 skipped (1165)
```

I read *"0 failed"* and concluded the attribution was **unguarded** — a wrong
conclusion about someone else's correct work, reached from a truthful line of
output. It took a second run with a wider filter to see `FAIL build.test.ts`.

That is what raises this from tidiness to p2. The defect is not that the
information is missing; it is that **the summary line a reader actually looks at
says `skipped` where it means `could not run`** — and `skipped` reads as
*deliberately excluded*, which is the one thing it is not.

Two independent occurrences in a day, once to the author and once to the
reviewer, both while doing exactly the work this repo relies on most.

## Notes back — CORE, 2026-09-01

**The comparison, run with a probe that passes `typecheck` and fails `build`** —
a `src` file importing from `test/`, which `tsconfig.build.json`'s
`rootDir: "src"` rejects. Same class as LAI-045's cast, and the reason this file
is a separate gate at all.

```
BEFORE   Tests  12 skipped (12)

AFTER    × compiles at all
         AssertionError: pnpm run build failed:
         src/version.ts(28,25): error TS6059: File '…/test/helpers/db.ts' is not
           under 'rootDir' '…/server/src'.
         Tests  1 failed | 12 skipped (13)
```

**One failure and twelve skips, not thirteen failures.** My first version threw
from a guard and produced `13 failed` — loud, but it turns one cause into
thirteen. The skips are honest; those tests genuinely did not run. What was
wrong before was never the word `skipped`, it was that it sat beside **zero
failures**.

**A mistake worth recording.** My first commit message said the typecheck
distinction was written into the module comment. It was not — AC4's requirement,
missed, and the message described something not in the diff. Caught by checking
the claim rather than trusting it, and fixed in a follow-up commit that says so
rather than an amend that would have hidden it.
