---
id: LAI-623
title: The commands the product tells people to run actually exist
area: cli
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-622
status: in-progress
started: 2026-09-28T17:21:59Z
---

## Goal

Every command Laika prints can be run. Two cannot today, and both are printed
to somebody who is trying to get started for the first time.

1. **`laika whoami`** — `TokensScreen`'s CLI quick start tells the reader to run
   it. `cli/src/index.ts` dispatches only `init`, so it prints
   `laika: unknown command "whoami"` and exits 1.
2. **`npx laika init`** — printed by `/laika:setup`, by `laika-common.sh` three
   times, by `plugin/hooks/README.md` and by `plugin/README.md`.
   `cli/package.json` is `private: true` and unpublished, so on a clean machine
   `npx laika` resolves to an unrelated public package or fails.

## Approach

`laika` becomes a real command, installed by the installer that already puts
`laika-claude` on PATH — no npm publish, which would need the owner's
credentials, a scope (`laika` is taken) and a release step, and which still
would not remove the checkout that `--plugin-dir` needs.

Node 22.18 runs the TypeScript directly and `cli/test/cli.test.ts` already
relies on it, so no build step is required; `dist/` is preferred when present.

## Acceptance criteria

- [ ] `cli/bin/laika` — a dependency-free `sh` shim that resolves `$0` through
      symlinks before deriving its paths (installed on PATH it *is* a symlink;
      LAI-616 and LAI-482 are the two defects that cost real time for exactly
      this), prefers `cli/dist/index.js` when readable and falls back to
      `cli/src/index.ts`, and names Node 22.18 when the runtime is too old
      rather than failing with a parse error.
- [ ] `install.sh` links it onto PATH beside `laika-claude`, guarding against a
      link that would point at nothing and against clobbering an unrelated
      `laika` already on PATH.
- [ ] `laika whoami` reports identity, board and token state against
      `GET /api/v1/me`, never printing the token, and distinguishes
      unconfigured / unreachable / refused / forbidden with its **own** wording
      — not `failureForStatus`, whose 401 says *"that email and password were
      refused"*, which is right for `init` and actively wrong for a revoked
      token.
- [ ] Every `npx laika init` under `cli/`, `plugin/` and `server/web/src/` is
      corrected, with a scoped guard so it cannot come back. `docs/` is CHIEF's
      and is filed separately, not edited.
- [ ] Tests in the sandbox-HOME style of `cli/test/plugin-install.test.ts`,
      with negative controls asserted to fail.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.

## Notes / context

- Owner-directed, 2026-09-28, after LAI-622 shipped the Connect screen.
- `private: true` stays: flipping it invites an accidental publish and does not
  make `npx laika` work.
