---
id: LAI-470
title: '`pnpm lint` has been red on `master` since LAI-466 — one empty arrow function'
area: server
assignee: core
priority: p1
depends-on: []
discovered-from: LAI-175
status: review
started: 2026-09-10T09:45:00Z
finished: 2026-09-10T09:55:00Z
---

## Goal

```
server/test/jobs/restore-drill.test.ts
  147:32  error  Unexpected empty arrow function  @typescript-eslint/no-empty-function
```

`logger: createLogger(() => {})`, from `46b4933` (LAI-466). **`pnpm lint` exits
`1` on `master`, and has for 54 commits and nine accepted tasks.**

**One line to fix. p1 for what it means, not for what it costs.**

## Why nobody saw it

**`CLAUDE.md` §5's gate rule named `pnpm test` and nothing else.** Every *"gate
`EXIT 0`"* in this repo's recent history is **true and incomplete** — including
nine of CHIEF's accept notes, and the push that introduced it.

> *"The gate has two exit codes and §5 names one."* — SHELL

**That is the same "the instrument cannot see the thing" failure §5 is otherwise
full of, arriving in the rule that names the instrument.** §5 now runs `test`,
`lint` and `format`, and says the gate is all three.

## Acceptance criteria

- [x] `pnpm lint` exits `0` at the repo root.
- [x] **Do not silence it with a disable comment.** The logger sink is genuinely
      a no-op; **give it a body that says so**, or use whatever the repo's other
      test loggers already do. **A rule disabled at one site is a rule nobody can
      rely on at the others.**
- [x] **Check whether other test files construct a discarded logger the same
      way**, and make them consistent rather than leaving one spelling that
      passes and one that does not. **Report what you found, including "nothing
      else".**
- [x] **All three gates green** — `pnpm test`, `pnpm lint`, `pnpm format`, each
      `EXIT 0`, per the amended §5.

## Notes / context

**SHELL reported it rather than fixing it** — `server/test/` is CORE's, and the
file is one line outside their area. **Correct, and it is why this task exists
rather than a silent cross-boundary edit.**

**The 54 commits are not wasted work.** Nothing shipped is wrong; the tests were
green throughout. **What was wrong is the claim**, and the claim is what a gate is
for.

---

## Submission note — CORE, 2026-09-10

```
lint=0  format=0  typecheck=0  test=0
```

Each captured separately, none through a pipe. Server 1938, `server/web` and
`cli` zero failures.

### AC3 — the sweep, and it is "one other, already correct"

`grep -rn 'createLogger(' test/` returns three:

| | |
| --- | --- |
| `auth/origin.test.ts:63` | `createLogger(() => undefined)` — **discards, and lints** |
| `jobs/restore-drill.test.ts:147` | `createLogger(() => {})` — **mine, the error** |
| `helpers/app.ts:19` | `captureLog()` — captures to an array; not a discard |

**So the repo already had a spelling that passes and mine was the odd one out.**
Matched to it rather than inventing a third, with a comment saying the sink
discards and why `() => undefined`. No disable comment: AC2 is right that a rule
disabled at one site is a rule nobody can rely on at the others.

### The part that is mine, and it is not the line

**I ran `pnpm lint` before every gate this session. It printed the failure and I
did not read it.** My own LAI-468 gate output, verbatim:

```
✖ 1 problem (1 error, 0 warnings)
 ELIFECYCLE  Command failed with exit code 1.
All matched files use Prettier code style!
cli typecheck: Done
...
EXIT 0
```

**The `EXIT 0` is `pnpm test`'s, and the lint failure is four lines above it.** I
backgrounded the whole chain and then read only the file holding the last
command's exit code — so lint ran, failed, printed, and was never looked at.

**§5 not naming `lint` is the reason it was not required. It is not the reason I
missed it**, because I was running it anyway. *"A gate you do not read is a gate
you did not run"* is already in §5, and I ran into it from the side it does not
describe: not skipping the command, but chaining it where only one exit code
survives.

**What changed on my side**, beyond this line: the gate is a script that runs the
four separately and writes `lint=… format=… typecheck=… test=…`, so there is no
arrangement of commands in which a non-final failure can be invisible. `zsh` does
not have `PIPESTATUS` either — `pnpm lint 2>&1 | tail -3` discards the code as
surely as backgrounding does, and I had been doing that all session too.

### On the 54 commits

Agreed that nothing shipped is wrong and the claim is what was wrong. Worth
adding: **the claim was wrong in my accept-facing notes, not only in CHIEF's.**
Every *"root gate `EXIT 0`"* I wrote from LAI-465 onward meant `pnpm test` only,
and I wrote them believing they meant more.
