---
id: LAI-230
title: `plugin/` has no workspace entry, so its tests cannot live beside it
area: plugin
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-418
status: backlog
---

## Goal

`pnpm-workspace.yaml` lists `server`, `server/web` and `cli`. It does not list
`plugin`, so a `plugin/package.json` would be inert: `pnpm -r run test` would
never reach it, and **a test that does not run is worse than no test**, because
the directory then looks covered.

LAI-418 put the heartbeat hook's 30 tests in `cli/test/plugin-hooks.test.ts` for
that reason. They test `plugin/hooks/heartbeat.sh` from the next package along.
It works and it is in the gate; it is also the wrong address, and the header
comment saying so is not a substitute for fixing it.

## Why it is p3

**Nothing is broken and nothing is uncovered.** This is an address change. The
reason to do it is that the next person adding a plugin test has to be told
where the last one went, and being told is how a second location gets invented.

## Acceptance criteria

- [ ] `plugin` is listed in `pnpm-workspace.yaml`, with a comment in the idiom
      of the existing entries.
- [ ] `plugin/package.json` exists, `private`, with a `test` script.
- [ ] **The first test in it fails when the thing the package exists for is
      absent.** A workspace whose `test` prints `# tests 0` and exits 0 is a hole
      in the root gate, which is what `cli/` did before LAI-422. Move
      `cli/test/plugin-hooks.test.ts`'s first case — *heartbeat.sh is present and
      executable* — and check it goes red when the file is moved away.
- [ ] `cli/test/plugin-hooks.test.ts` moves to `plugin/test/`, and the paragraph
      in `plugin/hooks/README.md` pointing at its old address is updated.
- [ ] The count in the root gate does not drop. **Compare the numbers before and
      after** — a move that silently loses tests is the failure this is most
      exposed to, and `# pass` totals are the only thing that shows it.
- [ ] Full gate green.

## Notes

**`pnpm-workspace.yaml` is a repo-root file and this task is what names it.**
Nothing else in the root is in scope. The existing entries carry comments
explaining that they were listed *before* the package existed, precisely so
adding one is never a root edit — that trick is not available here, because
`plugin` was never listed.

No new dependencies. The tests use `node --test` and nothing else, as `cli/`
does.
