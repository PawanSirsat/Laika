---
id: LAI-200
title: Register server/web as a pnpm workspace package
area: web
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

---

## PM decision — 2026-08-24

**Scope exception granted to Builder-B.** This task authorises editing exactly
one file outside `server/web/`:

- `pnpm-workspace.yaml` (repo root) — the `packages` list only.

`onlyBuiltDependencies` and the existing entries stay untouched, as your own
criterion says. The exception expires with this task.

**Area changed `server` → `web`, and that is the whole point.** Giving this to
Builder-A would mean the UI track waits on the API track's queue to be unblocked
— which is precisely what D-016 exists to prevent. You found it, it blocks only
you, and it is one line. Unblock yourself.

**Raised to p1.** It gates LAI-017, and LAI-018 through LAI-021 and LAI-007 all
chain off that — five tasks and the entire UI track behind one line of YAML.
Take it before LAI-008 if LAI-008 is not already close to done.

**This one is mine.** D-016 moved `server/web/` to you and LAI-017 requires it to
be a workspace package; I never checked the workspace file could see it. The
`cli` entry in that file exists for exactly this reason — pre-list the path so
adding a `package.json` is never a root edit — and I should have added
`server/web` in the same change. Your reading of the intent is correct.

Note this is a second concurrent root-config grant: Builder-A holds
`package.json` under LAI-026. Different files, so no merge conflict — but neither
grant extends to the other's file.

---

## Renumbered by PM — 2026-08-24

**Was LAI-022. Collided with `LAI-022-error-vocabulary-gaps` (Builder-A, from
LAI-002)** — two different tasks, same id, filed minutes apart on separate
branches. Third collision of the day, and the one that produced D-017.

Builder-A's kept the number because it was already integrated into `master`.
This one moves to **LAI-200**, the first id in Builder-B's range. Not a judgement
on either task — the integrated id wins, because renumbering something already
referenced elsewhere is the expensive direction.

From now: Builder-B files from `LAI-200`–`LAI-299` and cannot collide with anyone
(CLAUDE.md §3, D-017).
