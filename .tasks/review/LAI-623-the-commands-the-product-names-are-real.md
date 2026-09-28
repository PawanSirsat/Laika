---
id: LAI-623
title: The commands the product tells people to run actually exist
area: cli
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-622
status: review
started: 2026-09-28T17:21:59Z
finished: 2026-09-28T23:41:00Z
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

- [x] `cli/bin/laika` — a dependency-free `sh` shim that resolves `$0` through
      symlinks before deriving its paths (installed on PATH it *is* a symlink;
      LAI-616 and LAI-482 are the two defects that cost real time for exactly
      this), prefers `cli/dist/index.js` when readable and falls back to
      `cli/src/index.ts`, and names Node 22.18 when the runtime is too old
      rather than failing with a parse error.
- [x] `install.sh` links it onto PATH beside `laika-claude`, guarding against a
      link that would point at nothing and against clobbering an unrelated
      `laika` already on PATH.
- [x] `laika whoami` reports identity, board and token state against
      `GET /api/v1/me`, never printing the token, and distinguishes
      unconfigured / unreachable / refused / forbidden with its **own** wording
      — not `failureForStatus`, whose 401 says *"that email and password were
      refused"*, which is right for `init` and actively wrong for a revoked
      token.
- [x] Every `npx laika init` under `cli/`, `plugin/` and `server/web/src/` is
      corrected, with a scoped guard so it cannot come back. `docs/` is CHIEF's
      and is filed separately, not edited.
- [x] Tests in the sandbox-HOME style of `cli/test/plugin-install.test.ts`,
      with negative controls asserted to fail.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.
      **`lint` and `format` exit `0`; `test` exits `1`, and not on this work.**
      Left unticked rather than explained away — see "The gate" below.

## Notes / context

- Owner-directed, 2026-09-28, after LAI-622 shipped the Connect screen.
- `private: true` stays: flipping it invites an accidental publish and does not
  make `npx laika` work.

## The gate

`pnpm lint` → `0`. `pnpm format` → `0`. `pnpm test` → `1`.

`cli` and `server/web` are green (`# fail 0` both). Every failure is in
`server/test/tooling/`, and every one is the same shape:

```
FAIL test/tooling/environment-posture.test.ts > covers every package in the
     runtime closure that branches on the environment
Error: Test timed out in 5000ms.
```

**It is a flake, and the evidence is that the count moves without the code
moving.** Three consecutive runs of an unchanged tree gave **10 failures, then
5, then 1**, drawn from an overlapping but different set each time, and all
five of the files involved pass when run alone:

| run | failures |
| --- | --- |
| 1 (while a mutation harness was running) | 10 |
| 2 | 5 |
| 3 (quiet machine) | 1 |
| each file alone | **0** — 11/11, 10/10, 13/13 |

These are filesystem-walking, git-spawning tooling tests on a 5000ms budget,
and they lose that budget under parallel load. They are in CORE's area and my
diff touches `cli/`, `plugin/` and one new file under `server/web/test/`;
nothing under `server/src/` or `server/test/tooling/`.

Filed as **LAI-625** for CORE. I have not touched the budget — raising a
timeout from another session's worktree is exactly the crossing §1 forbids, and
a flaky guard is still a guard.

**One real failure did surface this way and is fixed**:
`structure.test.ts`'s web-mirror check was red on
`connect-token-name.ts`, a module LAI-622 added without a mirrored test. That
is LAI-622's defect, found by LAI-623's gate; written as a real test with a
control, committed separately as `[LAI-622]`, and `structure.test.ts` is 20/20.

## What the work found that the task did not predict

1. **`whoami` could not see what `install.sh` writes.** The installer writes
   `~/.laika/env` and nothing else; `whoami` read `~/.claude/settings.json` and
   nothing else. A clean sandbox, a successful install, then `laika whoami`:

   ```
   This machine is not connected to a board.
   ```

   From the command the installer's own last line promises will work, and the
   first command the Connect screen offers a new developer. `whoami` now reads
   both and **prints which file answered**, so D-046's two-locations problem is
   diagnosable instead of invisible. It does not *settle* D-046 — that is
   CHIEF's.

2. **The clobber guard did not guard.** It required
   `[ "$EXISTING" != "$BIN/laika" ]` as well as `[ ! -L "$EXISTING" ]`, meaning
   to spare our own link on a re-run — which `-L` already does. The extra clause
   only ever excused the one case that matters: **a real file somebody else put
   at the exact path we install to**. The sandbox overwrote one and the
   installer reported success. Removed, and **both** `ln -sf` sites were swept
   rather than the found one patched (CLAUDE.md §5: two data points are a
   sample, not a count) — `laika-claude` is now guarded the same way.

3. **The first version of the test file deadlocked**, and reported
   `# pass 0  # fail 0` with the *file* timing out. The stub board runs in the
   test process and the CLI was invoked with `execFileSync`, which blocks the
   event loop — so the server could never accept the connection the child was
   waiting on, and the reporter's own output was stuck behind the same blocked
   loop. Worth recording because the symptom names no test: it looks like a
   broken runner, not a broken test. Fixed with a promisified `execFile`.

4. **A stale `dist/` served frozen code, and the tests could not see it.**
   The shim preferred `cli/dist/index.js` whenever it was readable. Running the
   command for real, on this checkout, after all ten tests were green:

   ```
   $ ./cli/bin/laika whoami
   laika: unknown command "whoami"
     npx laika init     authenticate, create a token, and save it
   ```

   Both defects the task exists to fix, answered by a build five days old.

   **The sandbox could not catch it because the sandbox was cleaner than
   reality** — it copied `bin/` and `src/` and had no `dist/` to go stale. Same
   family as an assertion a broken setup satisfies, one level up: a *fixture*
   that omits the thing that breaks.

   `dist/` is gitignored, so a fresh clone takes the src path and a new
   teammate never hits this; every machine that has ever run `pnpm -C cli build`
   does, silently and for ever. The shim now takes `dist` only when no source
   file postdates it, with three tests including a control asserting a **fresh**
   `dist` is still used — without which "always ignore dist" would pass.

   Verified end to end against the live board afterwards, which is the check
   that should have come first:

   ```
   Board   http://52.72.203.206
   Token   present (lai_ prefix, 44 chars)
   Config  /Users/…/.laika/env
     Signed in   Pawan Sirsat <…> (owner)
     Projects    2
   ```

**Thirteen tests, all controls mutation-verified.** Final gate: `lint 0`,
`format 0`, `test 1` — two `server/test/tooling/` timeouts, the LAI-625 flake,
`cli` and `server/web` both `# fail 0`.
