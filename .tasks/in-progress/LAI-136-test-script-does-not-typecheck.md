---
id: LAI-136
title: pnpm test cannot catch a type error, so a green suite looks stronger than it is
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-045
status: in-progress
started: 2026-09-01T10:35:00Z
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

- [ ] A green `pnpm test` is impossible while a type error exists in the package
      it ran over. Whether that is vitest's `typecheck` option, a `pretest`
      hook, or `test` becoming a composite of typecheck-then-vitest is the
      implementer's call — argue it in the log.
- [ ] **Prove it.** Introduce a real type error of the
      `noUncheckedIndexedAccess` kind, confirm `pnpm test` now fails and names
      the file and line, then remove it. Put the failure output in the log.
      Today that case is green, and that is the whole point of the task.
- [ ] The same holds for `@laika/web`, whose `test` script is
      `node --test`, which also strips types without checking them. If the two
      packages need different mechanisms, say why in the log rather than fixing
      one and leaving the other.
- [ ] Whatever `pnpm test` becomes, it must still be usable as the inner loop —
      if it gets materially slower, say by how much, measured.
- [ ] `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
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
