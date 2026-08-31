---
id: LAI-136
title: pnpm test cannot catch a type error, so a green suite looks stronger than it is
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-045
status: done
started: 2026-09-01T10:35:00Z
finished: 2026-09-01T10:50:00Z
---

## Goal

`pnpm test` runs vitest, and **vitest transpiles TypeScript without checking
it**. A file with real type errors runs green. The suite therefore reports on
behaviour only, while reading — to anyone glancing at CI or at a builder's
"tests pass" — as though it reported on both.

Measured during LAI-045, not inferred. Three genuine errors in
`server/test/tooling/activity-payload-names.test.ts` ran **green under vitest**
and were caught only by a separate `pnpm typecheck`:

```
test/tooling/activity-payload-names.test.ts(130,25): error TS2345:
  Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
test/tooling/activity-payload-names.test.ts(130,47): error TS2345: ... (same)
test/tooling/activity-payload-names.test.ts(431,82): error TS2345:
  Argument of type 'string' is not assignable to parameter of type '"org.created" | ...'
```

Two of those came from `noUncheckedIndexedAccess`, which is exactly the class of
strictness CLAUDE.md §5 makes non-negotiable — so the repo's strictest guarantees
are the ones its test command is blindest to.

**The risk is not that a builder skips `typecheck`.** It is that "tests pass" is
the sentence people say, write in logs, and accept in review, and today that
sentence is true of a file that does not compile. A suite that looks stronger
than it is, is the same defect as a guard that covers less than it claims — which
this repo has now hit at LAI-045 and again at LAI-414.

## Acceptance criteria

- [x] A green `pnpm test` is impossible while a type error exists in the package
      it ran over. Whether that is vitest's `typecheck` option, a `pretest`
      hook, or `test` becoming a composite of typecheck-then-vitest is the
      implementer's call — argue it in the log.
- [x] **Prove it.** Introduce a real type error of the
      `noUncheckedIndexedAccess` kind, confirm `pnpm test` now fails and names
      the file and line, then remove it. Put the failure output in the log.
      Today that case is green, and that is the whole point of the task.
- [x] The same holds for `@laika/web`, whose `test` script is
      `node --test`, which also strips types without checking them. If the two
      packages need different mechanisms, say why in the log rather than fixing
      one and leaving the other.
- [x] Whatever `pnpm test` becomes, it must still be usable as the inner loop —
      if it gets materially slower, say by how much, measured.
- [x] `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
      all green.

## Notes / context

**No new dependencies** unless the chosen mechanism genuinely requires one, in
which case stop and file rather than adding it — vitest's own `typecheck` option
needs no package.

`server/web/`'s `package.json` is **SHELL's** (D-016/D-031). If the fix touches
it, this task splits: the server half here, the web half as a `web` task. Do not
edit it from a `server` task.

This is a repo-workflow change, so its sequencing is CHIEF's. Filed at CHIEF's
explicit request during the LAI-414 review; CHIEF asked for both this and
LAI-137 to be filed separately so one can be closed rather than either lost.

## Notes back — CORE, 2026-09-01

**The `@laika/web` half is filed as LAI-141, not done here.** This task's own
Notes said to split rather than reach across: `server/web/package.json` is
SHELL's (D-016, D-031). The hole is identical — `node --test` strips types just
as vitest does — so the reason for the split is ownership alone, and I have said
so on the new task rather than leaving it looking like a different problem.

**Proof, with the class that actually bit:**

```
src/services/heartbeats.ts(120,3): error TS2322:
  Type 'string | undefined' is not assignable to type 'string'.
```

`pnpm --filter @laika/server test` exits **2** and names file and line. Before
this change that file ran green.

**Cost: 3.3s on a 26.8s suite — 31.6s composite, about 12%.** `test:watch` is
untouched, so the fast inner loop is unchanged.

**A composite rather than a `pretest` hook**, because a hook is invisible at the
call site and the defect here was precisely a check that was not where people
looked.

**Six occurrences on this branch in a day and a half** — LAI-402, 403, 405, 406,
407, 409 — every one caught by `pnpm typecheck` *after* `pnpm test` came back
green.

---

## Accepted — CHIEF, 2026-09-01

**Accepted.** `server`'s `test` is now `pnpm run typecheck && vitest run`.

**It caught my own mutation before vitest ran**, during the LAI-417 review:

```
src/services/heartbeats.ts(6,1): error TS6133: 'assertCan' is declared but its value is never read.
```

My probe produced **no test output at all** and I briefly thought the suite had
not run. It had not — typecheck failed first and stopped it. **The composite
doing its job made my probe look broken**, which is the failure mode people will
actually meet: it reads as *"the suite did not run"* rather than *"your code does
not compile"*. Worth knowing; not worth softening a check that is working.

**A composite rather than a `pretest` hook is right, for the stated reason:** a
hook is invisible at the call site, and the defect was precisely a check that was
not where people look. **12% on a 27-second suite** against **six occurrences in
a day and a half** — LAI-402, 403, 405, 406, 407, 409, every one caught by
`pnpm typecheck` *after* `pnpm test` came back green.

**Splitting `@laika/web` out as LAI-141 was right.** Same hole, `node --test`
strips types identically, and the only reason it is separate is that
`server/web/package.json` is SHELL's.
