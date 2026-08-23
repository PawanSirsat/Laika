---
id: LAI-001
title: Repo tooling — pnpm workspaces, TypeScript strict, ESLint, Prettier, Vitest
area: server
assignee: builder-a
priority: p1
depends-on: []
discovered-from:
status: done
started: 2026-08-24T01:42:36+05:30
finished: 2026-08-24T01:51:45+05:30
reviewed: 2026-08-24T04:12:00+05:30
---

## Goal

Establish the build and quality baseline every other task assumes: a pnpm
workspace, a strict shared TypeScript config, lint and format that agree with
each other, and a test runner that runs. Nothing after this should have to argue
about tooling.

## Acceptance criteria

- [x] `pnpm-workspace.yaml` at repo root covering `server` (and `cli` as a
      placeholder so it can be added later without a root edit).
- [x] Root `package.json` with `packageManager` pinned, Node engine `>=22`, and
      scripts: `dev`, `build`, `test`, `lint`, `format`, `typecheck`.
- [x] `tsconfig.base.json` at root with `strict: true`, `noUncheckedIndexedAccess`,
      `noImplicitOverride`, `exactOptionalPropertyTypes`, `moduleResolution: bundler`,
      `target: ES2023`. `server/tsconfig.json` extends it.
- [x] ESLint flat config + Prettier, with `@typescript-eslint` type-aware rules
      on; `pnpm lint` and `pnpm format --check` both pass on a clean tree.
- [x] Vitest configured for `server`; a trivial passing test proves the runner
      works via `pnpm test`.
- [x] `.gitignore` covers `node_modules`, `dist`, `server/public`, `*.db`,
      `*.db-wal`, `*.db-shm`, `.env*`, coverage output.
- [x] `pnpm install && pnpm typecheck && pnpm lint && pnpm test` is green from a
      clean clone.

## Notes / context

Milestone: **M1**. This is the one task that unblocks nearly everything —
claim it first.

**Scope exception (see CLAUDE.md §1):** this task authorises Builder-A to create
repo-root files, limited to exactly: `package.json`, `pnpm-workspace.yaml`,
`tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.npmrc`, `.gitignore`,
`.nvmrc`. Nothing else at root. `CLAUDE.md`, `docs/`, `.tasks/`, `.claude/` stay
PM's.

Dependencies this task may add: `typescript`, `@types/node`, `eslint`,
`typescript-eslint`, `prettier`, `eslint-config-prettier`, `vitest`, `tsx`.
Nothing else without a new task.

---

## Notes at review — builder-a

**1. `pnpm format --check` has one finding, and it is not in `server/`.**
The check covers the whole repo and currently reports
`plugin/.claude-plugin/plugin.json` (Prettier collapses its `keywords` array
under `printWidth: 100`). `plugin/` is Builder-B's area, so Builder-A must not
touch it — **LAI-014 filed** (`area: plugin`, `discovered-from: LAI-001`).
Everything LAI-001 owns is Prettier-clean. If PM would rather the formatter
never look outside the pnpm workspace, that is a one-line change to the `format`
script and I will take it as review feedback.

**2. `pnpm-lock.yaml` is committed, and it is not in this task's file list.**
The scope exception names eight root files; the lockfile is not one of them. It
is committed anyway, because AC7 ("green from a clean clone") is not verifiable
without it and `pnpm install --frozen-lockfile` is the only honest reading of
"clean clone". Flagging it rather than assuming.

**3. `dev` and `build` are `--if-present` pass-throughs today.**
Both root scripts exist and exit 0; no workspace package defines `dev` or
`build` yet. `server` gets them in LAI-002 (server bootstrap via `tsx`) and
LAI-007 (Vite build into `server/public/`). The alternative was to invent a
`server/src/index.ts` here so `tsc` had inputs — that file belongs to LAI-002,
and writing it now would have collided.

**4. TypeScript is pinned to `~6.0.3`, not the latest `7.0.2`.**
`typescript-eslint@8.67.0` declares `typescript: ">=4.8.4 <6.1.0"`. TS 7 is the
native port and is outside that range, so type-aware linting — an explicit
requirement of this task — would have been unavailable. 6.0.3 is the newest
version the linter supports.

**5. Prettier does not format Markdown.**
The `format` globs cover code and config only. Reformatting `.md` would rewrite
`docs/`, `CLAUDE.md`, `.tasks/**` and other sessions' logs — all outside
Builder-A's area, and all hand-formatted to 80 columns on purpose.

**Verified before moving to review** (fresh `git clone` into a temp dir):
`pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm lint` → `pnpm test`
all exit 0. `pnpm build` exits 0. Type-aware linting confirmed live by a
throwaway probe file that correctly failed on `no-explicit-any` and
`no-floating-promises`.

## Review — PM, 2026-08-24

**Accepted.** Verified by running the toolchain, not by reading the ticks.

- `pnpm typecheck`, `pnpm lint`, `pnpm test` → all exit 0 (3 tests pass).
- Every required flag present in `tsconfig.base.json` (`strict`,
  `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`,
  `moduleResolution: bundler`, `target: ES2023`); `server/tsconfig.json` extends it.
- `.gitignore` covers all eight required patterns including `*.db-wal` / `*.db-shm`.
- `pnpm format --check` reports exactly one file, `plugin/.claude-plugin/plugin.json`,
  which is Builder-B's area. Correctly filed as LAI-014 rather than fixed.

**Answers to the review notes.**

1. **Keep the formatter repo-wide.** Declined the offer to scope `format` to the
   pnpm workspace. A formatter that only looks where it is already clean stops
   being a check. The one finding is real, it is in someone else's area, and
   LAI-014 is the right resolution — narrowing the glob would have hidden it
   instead.
2. **Lockfile accepted, scope exception amended.** `pnpm-lock.yaml` was outside
   the eight named files, and committing it was correct anyway: AC7 says "green
   from a clean clone" and `--frozen-lockfile` is the only honest reading of
   that. The exception in this task file now covers nine files. Flagging it
   rather than quietly committing it was exactly right.
3. **`dev`/`build` as `--if-present` pass-throughs: correct call.** Inventing
   `server/src/index.ts` here would have collided with LAI-002.
4. **TypeScript pinned to `~6.0.3`: correct call.** Type-aware linting is an
   explicit requirement of this task and `typescript-eslint@8` caps at `<6.1.0`.
   Taking TS 7 would have satisfied "latest" by dropping a stated requirement.
5. **Prettier skipping Markdown: correct call.** Reformatting `.md` would have
   rewritten `docs/`, `CLAUDE.md` and other sessions' logs — all outside the area.

**Boundary note, not a finding.** These commits also touch
`plugin/commands/README`, outside Builder-A's area. That is an artefact of the
shared working tree that existed before D-008, not a boundary crossing by this
session. No action.
