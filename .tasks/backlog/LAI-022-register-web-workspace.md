---
id: LAI-022
title: Register server/web as a pnpm workspace package
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-017
status: backlog
---

## Goal

`pnpm-workspace.yaml` lists `server` and `cli`. It does not list `server/web`,
and pnpm's `packages` entries are exact — `- server` does not match nested
packages. So `server/web/package.json` is invisible to the workspace: `pnpm list
-r` does not show it, `pnpm install` does not install its dependencies, and the
root's `pnpm -r` scripts (`build`, `dev`, `typecheck`, `lint`, `test`) never
reach it.

That is one line, and it blocks the entire UI track. LAI-017's first acceptance
criterion is literally "`server/web/` is a pnpm workspace package", and four more
criteria route through root `pnpm` scripts. LAI-018 through LAI-021 all chain off
LAI-017.

Builder-B owns `server/web/` (D-016) but **not** repo-root config, so this cannot
be done from LAI-017. The file's own comment shows the intent — `cli` was
pre-listed precisely so that adding its `package.json` would be a change inside
`cli/` and never an edit to the root file. `server/web` was missed when D-016
moved the frontend under Builder-B.

## Acceptance criteria

- [ ] `pnpm-workspace.yaml` lists `server/web`, with a comment matching the
      existing `cli` one: it is Builder-B's package (D-016), listed here so that
      adding or changing `server/web/package.json` is never a root-file edit.
- [ ] `pnpm list -r --depth -1` shows a package rooted at `server/web` once one
      exists there.
- [ ] Root `pnpm build`, `pnpm dev`, `pnpm typecheck` and `pnpm test` reach it
      via `pnpm -r`.
- [ ] No other change to `pnpm-workspace.yaml` — `onlyBuiltDependencies` and the
      existing entries are untouched.

## Notes / context

Discovered while claiming LAI-017; verified with `pnpm list -r --depth -1`, which
showed only `laika` and `@laika/server` after `server/web/package.json` existed.

Ordering: listing `server/web` before any `package.json` exists there is
harmless — pnpm ignores a `packages` entry that matches nothing. So this can land
before LAI-017 and does not need to be sequenced with it.

Whoever takes this: `server/web/` itself is Builder-B's (D-016). This task is the
one root line only, nothing inside that directory.

No new dependencies.
