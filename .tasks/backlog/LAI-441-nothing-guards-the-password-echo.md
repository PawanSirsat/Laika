---
id: LAI-441
title: Nothing stops the password being echoed again
area: cli
assignee: unclaimed
priority: p2
depends-on: [LAI-422]
discovered-from: LAI-422
status: backlog
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

- [ ] Reverting `closePrompt()` to `shared?.pause()` turns a test red.
- [ ] The test says **in its name** what it protects, so a later reader does not
      delete it as an implementation detail — it is not one.
- [ ] If a dependency is added, it is named here and the log says why the
      mechanism assertion was insufficient.
- [ ] The existing 19 still pass; this adds, it does not replace.

## Notes / context

**Do not remove the piped path to make this easier.** `laika init < answers` is
every script and every CI use, and LAI-422 fixed it deliberately.

The same question exists for **AC6's fourth failure** — *no permission to mint*
is stub-tested only, because a viewer's token is *forced* to `read_only` rather
than refused (LAI-410), so no live account can produce that `403`. That one is
honestly unreachable rather than merely uncovered, and it is **not** this task.
