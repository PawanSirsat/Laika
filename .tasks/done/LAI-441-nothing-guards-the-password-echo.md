---
id: LAI-441
title: Nothing stops the password being echoed again
area: cli
assignee: shell
priority: p2
depends-on: [LAI-422]
discovered-from: LAI-422
started: 2026-09-09T17:51:58+05:30
finished: 2026-09-09T18:07:22+05:30
status: done
---

## Goal

LAI-422 found and fixed a real defect: **the password was echoed in full**,
because a *paused* `readline` still owns the terminal's mode, so
`setRawMode(true)` never took. Verified by hand through a real pty.

**Nothing in the suite catches it coming back.** Measured during review —
replacing `closePrompt()` with `shared?.pause()` in `prompt.ts` leaves the cli
suite at **19 passing, 0 failing**. The fix is one word from being undone and
the gate would not notice.

**This is not a criticism of LAI-422.** Its test file says so plainly — *"the
closest the suite can get to the pty run recorded on the task without adding a
dependency"* — and a piped stdin **has nothing to echo**, so no amount of care
with the existing harness would cover it. LAI-422's Notes forbid a new
dependency, so the builder was not permitted to close this.

## Why it is worth a task rather than a note

**A regression prints passwords onto terminals and into scrollback**, silently,
for everyone who runs `npx laika init` — and the one place it cannot show up is a
CI run, which is where anyone would look for it.

## Two shapes; the second needs no dependency

**A pty test.** `node-pty` or equivalent. **This task names the dependency**, so
adding one is permitted under CLAUDE.md §5 — but say in the log why the second
shape was not enough, because a native dependency in `cli/` is a real cost for a
package whose whole pitch is `npx` with nothing installed.

**Or assert the mechanism.** The bug is *"raw mode set while a `readline` still
owns the tty"*. A unit test can assert that the shared interface is **closed, not
paused**, before `setRawMode(true)` — a fake `stdin` recording the call order is
enough. Weaker, because it pins an implementation rather than the property; but
it fails on exactly the edit that caused the bug, needs nothing new, and can ship
today.

**Whichever: prove it fails.** Make the mutation — `close()` → `pause()` — and
watch the new test go red. A guard for this that has not been seen to fail is
worth nothing, and this is the file where that has already been true once.

## Acceptance criteria

- [x] Reverting `closePrompt()` to `shared?.pause()` turns a test red.
- [x] The test says **in its name** what it protects, so a later reader does not
      delete it as an implementation detail — it is not one.
- [x] If a dependency is added, it is named here and the log says why the
      mechanism assertion was insufficient.
- [x] The existing 19 still pass; this adds, it does not replace.

## Notes / context

**Do not remove the piped path to make this easier.** `laika init < answers` is
every script and every CI use, and LAI-422 fixed it deliberately.

The same question exists for **AC6's fourth failure** — *no permission to mint*
is stub-tested only, because a viewer's token is *forced* to `read_only` rather
than refused (LAI-410), so no live account can produce that `403`. That one is
honestly unreachable rather than merely uncovered, and it is **not** this task.


---

## Submitted — SHELL

Root gate `EXIT 0` — 1836 server, 644 web, **72** cli. **No dependency added.**

### The mutation, and the column that matters

| edit | new guard | pre-existing suite |
| --- | --- | --- |
| **`closePrompt()` → `shared?.pause()`** — the exact LAI-422 bug | **RED** | still green |
| raw mode never entered | **RED** | still green |
| raw mode never handed back | **RED** | still green |

**The right-hand column is the task.** All three defects were invisible before
and are caught now, and the first is the one that prints passwords into
scrollback.

### `node-pty` was permitted and is not taken

The task names the dependency, so adding it was allowed. It is not, because the
mechanism assertion **fails on exactly the edit that caused the bug** — shown
above, not assumed — and a native module in a package whose whole pitch is `npx`
with nothing installed is a real cost for one test.

### The assertion is a comparison, not a number, and the first draft was wrong

The guard is *"the readline let go of the input before raw mode was set"*. I
first wrote it as **`0` listeners**, from a probe on a bare `PassThrough`. That
is not what a closed `readline` leaves here, so **the test failed against correct
code**. Both sides were then measured through the real harness:

```
           while the interface is open   at askSecret's setRawMode(true)
close()    2 listeners                   1      <- it let go
pause()    2 listeners                   2      <- it did not
```

So it asserts **fewer than while open**. The number was never the property.

### One scenario per file, and it is a harness limit I am stating

Substituting `process.stdin` works for the **first** `prompt.ts` instance in a
process and not a second, however the module is cache-busted — the later instance
stops seeing the fake and `askSecret` never settles. **Measured**: the same
scenario passes alone and hangs when it runs second, outside `node:test` as well
as inside, so it is the substitution and not the runner.

Rather than ship three tests where two are load-order-dependent, there is **one
scenario** in the order `init` actually uses — URL, email, then password — with
every property checked against it. The limitation is written where the next
person will hit it.

### AC2's name

`the shared readline is closed, not paused, before raw mode is set` — it says
what it protects, so a reader does not delete it as an implementation detail. It
is not one: **it is the difference between a password on screen and not.**

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** Gate `EXIT 0` — 1836 server, 644 web, **72** cli. **No dependency
added.**

### I re-ran all three mutations, and the right-hand column myself

| mutation | new guard | pre-existing suite |
| --- | --- | --- |
| `shared?.close()` → `shared?.pause()` — the exact LAI-422 bug | **RED** | **`# pass 71  # fail 0`** |
| `setRawMode(true)` removed | **RED** | — |
| `setRawMode(false)` removed | **RED** | — |

**Seventy-one green tests with the password-echo bug put back.** That is the
claim this task was filed on, and it is now measured rather than argued. The suite
was not weak here; **it was blind here** — no assertion in it can see the terminal
mode, so no amount of adding to it would have caught this.

### Declining `node-pty` is the right call, and for the stated reason

> *"The mechanism assertion fails on exactly the edit that caused the bug — and
> a native module in a package whose whole pitch is `npx` with nothing installed
> is a real cost for one test."*

**The permission to add it did not oblige you to.** A task's Notes naming a
package is a ceiling, not an instruction, and the argument here is about what the
package *does to the product*, not about effort.

### The assertion that failed against correct code

**This is the best thing in the submission.**

> *"I asserted **0** readline listeners at raw-mode entry, from a probe on a bare
> `PassThrough` where `close()` does leave 0. It leaves **1** in the real
> harness."*

```
           while open   at askSecret's setRawMode(true)
close()    2            1     <- let go
pause()    2            2     <- did not
```

> *"It asserts **fewer than while open** now. **The number was never the
> property.**"*

**Same shape as the calendar fixture, and you spotted it yourself in the same
session** — *a fact that happened to be true in one setup, written down as if it
were the rule*. Twice in a day, in unrelated files, from unrelated causes. That is
not a coincidence about you; **it is the most common way a green test comes to be
wrong**, and it now has two worked examples in the log.

**And `assert.ok(entered.length > 0, 'raw mode was never set')` before it** is the
*check that your check ran* rule applied without being asked: a code path that
never enters raw mode fails loudly instead of satisfying `atEntry < whileOpen`
with `-1`.

### The harness limit, stated rather than hidden

> *"Substituting `process.stdin` works for the **first** `prompt.ts` instance in a
> process and not a second, however the module is cache-busted… Measured outside
> `node:test` as well, so it is the substitution and not the runner."*

**One scenario, in the order `init` actually uses, with the limit written where
the next person meets it.** Ruling out the runner is what makes this a limit
rather than a guess — and a known boundary in a comment beats an untested second
scenario that looks like coverage.

### LAI-232

**Filed exactly right.** *No fixture in the suite gives the Board a project with
sprints*, so everything inside `{sprints.length > 0 && …}` has never rendered
anywhere. **The misplaced strip is the one defect a screenshot happened to catch;
nothing says it is the only one** — and requiring *"nothing else"* to be said out
loud is what stops the fix being a moved div.
