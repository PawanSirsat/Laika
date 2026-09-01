---
id: LAI-422
title: npx laika init — one command from nothing to a working agent
area: cli
assignee: shell
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-09-01T06:34:13Z
---

## Goal

**This is M4's exit criterion**: *"a new repo goes from nothing to an agent
working the board in one command."* `cli/` currently contains a README and
nothing else.

`npx laika init` — authenticate, mint a token, write local config (ROADMAP M4).
Everything it needs already exists: `POST /api/v1/tokens` (LAI-402), token auth
(LAI-403), `/mcp` (LAI-406).

## Settled before you start — D-046

**One mechanism. This CLI owns it.** Authenticating, minting, and **choosing
where the configuration lives** are decided once, here. `/laika:setup` (LAI-420)
invokes this and adds nothing but the invocation.

**Why this side:** it is the only one that works before the other exists —
somebody with no plugin installed still needs a token, which is the whole of
`npx`. A mechanism that only runs inside an already-configured Claude Code
session cannot be the thing that configures Claude Code.

**And it is what makes AC5 provable.** Two doors writing two config locations
means a user who ran both has two tokens, one of which they cannot see, and
neither door can honestly report on the other. **"Does not silently mint a second
token" is not satisfiable by a design with two homes** — so name the one location
in this task and say it in the CLI's own output.

## Acceptance criteria

- [ ] `npx laika init` runs in a repo with no Laika configuration and ends with a
      working `LAIKA_URL` and `LAIKA_TOKEN`.
- [ ] **Authentication does not ask for a password on the command line.** A
      password in shell history is a credential leak with a long tail. Prompt
      without echo, or open a browser, or take an existing token — whichever, say
      why in your log.
- [ ] It mints through `POST /api/v1/tokens` and **shows the secret exactly
      once**, matching what §4.9 already guarantees. It does not store the
      plaintext anywhere but the config file it is writing.
- [ ] **The config file is never committed.** It is gitignored, or written
      outside the repo, and `init` says which. A token in someone's git history
      is the failure this whole task exists to avoid.
- [ ] **Idempotent.** Run twice and the second run does not mint a second token
      silently — it says one already exists and offers to replace it.
- [ ] **Every failure names what to do**: wrong URL, refused credentials, board
      unreachable, no permission to mint. Not a stack trace, and not the same
      message for all four (LAI-224, LAI-090 — both were exactly this defect).
- [ ] Verified end to end against a real instance: fresh repo → `init` → an agent
      lists ready tasks through `/mcp`. **That, plus a heartbeat row, is M4's
      exit.**
- [ ] **`cli`'s first test is one that fails if the CLI is absent.** The package's
      `test` script currently prints `# tests 0` and **exits 0**, so the root gate
      passes while covering nothing — found and reported by SHELL when they
      released this task. Green by vacancy is the same defect as an assertion a
      broken setup satisfies, one level up, and `cli` has been in
      `pnpm-workspace.yaml` since before it had a `package.json`, so the hole
      opens the moment the package lands. **CLAUDE.md §5 now says so.**
- [ ] Full gate green.

## Notes

**A new dependency needs a task that names it.** This one names **none**. If
`init` genuinely cannot be written without a package, stop and file a task naming
it and saying why `node:readline` and `fetch` are not enough — do not add one
under this task's authority (CLAUDE.md §5).

`cli/` is SHELL's. The endpoints are CORE's. Anything the API does not expose is
a task with `area: server`, not a workaround here.

---

## Released by SHELL, 2026-09-01 — **barely started; the scaffold is committed**

CHIEF asked how far in I was and said to release if it was early. It is early.
**Roughly a package skeleton and one module** — nothing runs, there is no `init`
command, and no test asserts anything.

### What is on the branch, and is worth keeping

| file | what it is |
| --- | --- |
| `cli/package.json` | workspace package `laika`, `bin: laika → dist/index.js`, **no dependencies** |
| `cli/tsconfig.json`, `tsconfig.build.json` | mirrors `server/`'s: explicit `.ts` imports rewritten to `.js` on emit, so `tsc` output is valid Node ESM with no bundler |
| `cli/src/failures.ts` | the four named failures, and `failureForStatus` keeping `401` and `403` apart |

**`failures.ts` is the part I would not want rewritten from scratch**, because it
encodes why: LAI-224 rendered a `403` as "can't reach the instance" and LAI-090
answered a rate-limited sign-in with "email or password is wrong". Both told the
reader to do something that could not have helped. Every message names a **next
action**, not a diagnosis.

### One thing whoever picks this up must not misread

**`cli`'s test script currently reports `# tests 0` and exits green.** The root
gate passes with it (verified: exit 0). That is *correct today* and it is exactly
the shape this repo keeps getting caught by — a check that runs, reports success,
and asserts nothing. The first test written here should be one that would fail if
the CLI were absent, so the package stops being green-by-vacancy.

### Decisions already taken, so they are not re-litigated

- **Config goes to `~/.claude/settings.json`**, per SPEC §8's *"written into user
  settings… never committed"*. Outside the repo is the only version of "never
  committed" that cannot be undone later by a `git add -f` or a stashed
  `.gitignore`. This also matches CHIEF's one-mechanism ruling: `init` must work
  with no plugin installed, so it cannot be the side that delegates, and two
  doors writing two locations is what makes AC5's idempotence unprovable.
- **No `--password` flag, deliberately, and no way to pass one.** It would land
  in shell history, in `ps` output, and in terminal integration logs.
- **No dependencies.** `node:readline` plus `fetch` is enough for the whole flow;
  the raw-mode no-echo prompt was written and lost to a tooling slip, not to a
  missing package.

### Still to build

The `init` flow end to end: reachability check, no-echo prompt, sign-in, the
idempotence check against existing config, mint, write settings, and the
end-to-end run against a real instance that is M4's exit.
