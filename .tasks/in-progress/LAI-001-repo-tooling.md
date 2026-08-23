---
id: LAI-001
title: Repo tooling — pnpm workspaces, TypeScript strict, ESLint, Prettier, Vitest
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

Establish the build and quality baseline every other task assumes: a pnpm
workspace, a strict shared TypeScript config, lint and format that agree with
each other, and a test runner that runs. Nothing after this should have to argue
about tooling.

## Acceptance criteria

- [ ] `pnpm-workspace.yaml` at repo root covering `server` (and `cli` as a
      placeholder so it can be added later without a root edit).
- [ ] Root `package.json` with `packageManager` pinned, Node engine `>=22`, and
      scripts: `dev`, `build`, `test`, `lint`, `format`, `typecheck`.
- [ ] `tsconfig.base.json` at root with `strict: true`, `noUncheckedIndexedAccess`,
      `noImplicitOverride`, `exactOptionalPropertyTypes`, `moduleResolution: bundler`,
      `target: ES2023`. `server/tsconfig.json` extends it.
- [ ] ESLint flat config + Prettier, with `@typescript-eslint` type-aware rules
      on; `pnpm lint` and `pnpm format --check` both pass on a clean tree.
- [ ] Vitest configured for `server`; a trivial passing test proves the runner
      works via `pnpm test`.
- [ ] `.gitignore` covers `node_modules`, `dist`, `server/public`, `*.db`,
      `*.db-wal`, `*.db-shm`, `.env*`, coverage output.
- [ ] `pnpm install && pnpm typecheck && pnpm lint && pnpm test` is green from a
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
