---
id: LAI-422
title: npx laika init — one command from nothing to a working agent
area: cli
assignee: shell
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-09-01T06:57:50Z
finished: 2026-09-01T08:20:00Z
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

- [x] `npx laika init` runs in a repo with no Laika configuration and ends with a
      working `LAIKA_URL` and `LAIKA_TOKEN`.
- [x] **Authentication does not ask for a password on the command line.** A
      password in shell history is a credential leak with a long tail. Prompt
      without echo, or open a browser, or take an existing token — whichever, say
      why in your log.
- [x] It mints through `POST /api/v1/tokens` and **shows the secret exactly
      once**, matching what §4.9 already guarantees. It does not store the
      plaintext anywhere but the config file it is writing.
- [x] **The config file is never committed.** It is gitignored, or written
      outside the repo, and `init` says which. A token in someone's git history
      is the failure this whole task exists to avoid.
- [x] **Idempotent.** Run twice and the second run does not mint a second token
      silently — it says one already exists and offers to replace it.
- [x] **Every failure names what to do**: wrong URL, refused credentials, board
      unreachable, no permission to mint. Not a stack trace, and not the same
      message for all four (LAI-224, LAI-090 — both were exactly this defect).
- [x] Verified end to end against a real instance: fresh repo → `init` → an agent
      lists ready tasks through `/mcp`. **That, plus a heartbeat row, is M4's
      exit.**
- [x] **`cli`'s first test is one that fails if the CLI is absent.** The package's
      `test` script currently prints `# tests 0` and **exits 0**, so the root gate
      passes while covering nothing — found and reported by SHELL when they
      released this task. Green by vacancy is the same defect as an assertion a
      broken setup satisfies, one level up, and `cli` has been in
      `pnpm-workspace.yaml` since before it had a `package.json`, so the hole
      opens the moment the package lands. **CLAUDE.md §5 now says so.**
- [x] Full gate green.

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

---

## Briefly released by SHELL, 2026-09-01 — LAI-151 takes precedence

Released **only** to respect one-task-in-progress while I land LAI-151, a
closed-vocabulary mirror blocking a finished server task. **Re-claiming
immediately after.** Nothing uncommitted.

**Code complete and tested. What remains is the end-to-end run** — fresh repo →
`init` → an agent lists ready tasks through `/mcp`, which is M4's exit and is
worth doing for real rather than reasoning about.

On the branch: `src/{index,init,api,config,prompt,failures}.ts` and
`test/cli.test.ts` — **13 tests, and the first is the one that fails if the CLI
is absent**, closing the `# tests 0` hole this task carried as a criterion.

---

## Build note — SHELL, 2026-09-01

### M4's exit, run rather than reasoned about

Fresh `git init` repo, empty `HOME`, driven through a **real pty**:

```
Board URL [http://localhost:3000]: http://localhost:3370
Found a Laika at http://localhost:3370.
Email: ada@example.com
Password:
Connected. Token "laika-cli on …" (lai_7C4Z…) saved to
  /private/tmp/fake-home/.claude/settings.json          mode 0600
```

Then, using **only what `init` wrote**:

```
POST /mcp  tools/call list_ready_tasks {"project":"laika-core"}
→ ## Ready tasks (4)
  - LAI-10 Token screen — p2, todo …
```

**That is the exit criterion**, and none of the three defects below would have
been found without running it.

### Three defects the unit tests could not see

**1. Each question closed stdin for the next one.** Every `ask()` created its own
`readline` and closed it. Each call was correct *alone*; the **sequence** failed,
and `init` exited silently after printing "Email:". One shared interface now.

**2. The password was echoed in full.** With a pty I could see what a user sees:
`Password: laika-dev-password-1` on screen. A **paused** `readline` still owns
the terminal's mode, so `setRawMode(true)` did not take. It closes rather than
pauses now, and the run reports `PASSWORD ECHOED: False`. **AC2 was the criterion
most obviously met on paper and it was not met.**

**3. `laika init < answers` could not work at all.** A piped `readline` closes at
EOF, which arrives while `init` is awaiting a network call, so the next question
rejected with *"readline was closed"*. That is not only a testing problem — it is
every script and every CI use. Without a terminal the input is now drained once
and served from a queue.

### The suite can drive it now, which is why (3) is worth more than a workaround

`test/init-e2e.test.ts` runs the **built CLI as a subprocess** against a stub
board: the full sequence, idempotence, a refused sign-in, a `403` on mint, and an
unreachable board. **19 tests where there were `0`** — and the first is still the
one that fails if the CLI is absent, which was the criterion I left on this task
when I released it.

**And a fourth defect, in my own test.** It deadlocked: `execFileSync` blocks the
event loop, so the stub board in the same process could never answer the child.
The symptom was a timeout with no failing assertion, which reads as a hung CLI
rather than a hung test. Async now, and the reason is in the file.

### AC6 verified against real conditions, three of four

| | |
| --- | --- |
| wrong URL | *"Could not reach that board (fetch failed)… include the scheme."* |
| not a Laika | *"Something answered… A proxy or a different app on the same port will do this."* |
| wrong password | *"That email and password were refused… Laika is invite-only."* |
| no permission to mint | **unit-tested only** |

The fourth is honest to flag: a viewer's token is **forced** to `read_only`
rather than refused (LAI-410), so I could not produce a live `403` on mint with
an active account. It is covered by a stub returning `403`, and asserted to be a
different message from a bad password — the LAI-224 / LAI-090 defect.

### Idempotence, measured on the board

Second run: *"already connected… Replace it? [y/N]"*, default no. **Tokens on the
board before: 3. After: 3.** The stored token was unchanged.

### Notes

No dependencies. Config to `~/.claude/settings.json` (§8, D-046) at `0600`; the
run says where it went and that Laika keeps only a hash. Verified on my own
instance on `:3370` rather than the owner's board, so no token was minted there.
