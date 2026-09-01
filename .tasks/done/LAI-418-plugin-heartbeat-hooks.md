---
id: LAI-418
title: Plugin hooks — heartbeat on session start, stop, and a timer
area: plugin
assignee: shell
priority: p1
depends-on: [LAI-417]
discovered-from:
started: 2026-09-01T14:05:00+05:30
finished: 2026-09-01T15:40:00+05:30
status: done
---

## Goal

`plugin/hooks/hooks.json` is `{}` today, with a comment saying *"empty by design
until M4"*. This is M4.

Three hooks (SPEC §8): **`SessionStart`**, **`Stop`**, and a **throttled
`PostToolUse`** firing at most every 5 minutes while a session is active. Each
posts `{ repo, branch }` to `$LAIKA_URL/api/v1/heartbeats` with
`Authorization: Bearer $LAIKA_TOKEN`.

## Acceptance criteria

- [x] All three hooks are registered and fire. The `PostToolUse` one is
      **throttled to at most once per 5 minutes** — a hook on every tool call
      would post hundreds of times an hour.
- [x] **`|| true` on every hook, and it is not decoration.** SPEC §8: *"A board
      that is down, slow, or unreachable must never break a coding session."*
      **Prove it**: point `LAIKA_URL` at a dead port and confirm a session starts,
      runs and stops normally. Put the result in your log — this is the criterion
      most likely to be assumed rather than tested.
- [x] **Unconfigured is silent, not broken.** With `LAIKA_URL` or `LAIKA_TOKEN`
      absent the hooks do nothing and say nothing. The plugin must load cleanly
      when unconfigured (§8); a hook that logs a warning on every session start
      of every repo that does not use Laika is a defect.
- [x] `repo` is **`git config --get remote.origin.url` verbatim** — not the
      basename, not `owner/name`, not stripped of `.git`. **Do not parse it.**
      Normalising is the server's job (**D-043**, LAI-144): the server is the only
      side that can be fixed after a plugin ships, and a plugin that
      half-normalises invents a form the server has to guess at. `branch` is the
      current branch. Both resolved without failing when there is no remote, no
      branch, or no git repo at all — degrade to skipping the post, never to an
      error.
- [x] A short timeout on the request. A board that hangs must not hang the hook.
- [x] **No secret is committed.** `LAIKA_URL` and `LAIKA_TOKEN` come from the
      environment; anything committed carries an obviously-placeholder value.
- [x] `plugin/hooks/README.md` no longer says "empty by design until M4", and
      **states the exact form `repo` is sent in**, with an example. Today it says
      *"git remote"*, which is the sentence that produced LAI-144 — a reader
      implementing a second client cannot tell from it whether to send a URL or
      `owner/name`, and the two do not match each other.
- [x] Full gate green.

## Notes

No new dependencies. Shell and `curl`, as §8's snippet shows.

**Verify against a real board**, not only a dead one: post a heartbeat from a
real session and confirm the row exists. That is half of M4's exit criterion.

---

## CHIEF note — 2026-09-01

**AC4 was wrong when I wrote it.** It said the *"git remote basename"*, which is
a fifth form (`Laika`, or `Laika.git`) matching neither §4.3's `owner/name` nor
anything the server will parse. Building it as written would have produced
exactly the defect LAI-144 describes, in new code, on the same day the defect was
filed. Corrected above under **D-043**.

**No dependency on LAI-144.** A heartbeat whose `repo` resolves to no project
still records — §9.2 says it degrades — so this task is testable and shippable
before the server-side parser exists. Its own AC ("post a heartbeat from a real
session and confirm the row exists") is satisfied either way. What needs LAI-144
is §9.3 presence being non-empty, and that is LAI-144's criterion, not this one.

Two hard parts here are the two most likely to be assumed: **`|| true` proven
against a dead port**, and **silence when unconfigured**. Both are stated as
criteria because both are invisible when they fail — a hook that breaks a session
breaks it in someone else's repo, and a hook that warns on every session start
warns on every repo that has never heard of Laika.


---

## Submitted — SHELL, 2026-09-01

**Root gate `EXIT 0`** — 1701 server, 585 web, **49** cli; format, lint,
typecheck clean, and **zero** lines matching `Unhandled|Errors|Failed|not ok`.
Checked by exit code, per CLAUDE.md §5 as of this morning.

`plugin/hooks/heartbeat.sh`, `hooks.json`, `README.md`, and 30 tests in
`cli/test/plugin-hooks.test.ts` (LAI-230 asks for the workspace entry that lets
them move next door).

### The two criteria you said would be assumed, run rather than reasoned about

Real Claude Code sessions throughout, loaded with `--plugin-dir` so nothing in
anyone's config was touched, against my own board on **:3371** — never
`localhost:3000`.

**All three hooks fire.** With the throttle stamp held clear from outside, one
session produced **four** heartbeats: SessionStart, two PostToolUse, Stop.

**The throttle works.** The identical session with the stamp left alone produced
**one**. Four firings, one row — which is the design, and it is why the stamp had
to be manipulated to see the other three at all.

**`|| true` against a dead port.** `LAIKA_URL=http://127.0.0.1:1`, a real
session: started, ran, stopped, **exit 0**, 14s against 12s configured. And
separately `127 → 0` for the layer the script cannot cover itself — missing,
unreadable, or not executable.

**Unconfigured is silent.** No `LAIKA_URL`, no `LAIKA_TOKEN`: exit 0, stdout
exactly the answer, **zero bytes** from the hook. Both that session and the dead
port left 157 bytes on stderr, so **I ran a control session with no plugin at
all** — the same 157 bytes, Claude Code's own `no stdin data received` warning.
The claim was true either way; it is now verified rather than inferred.

### `repo` verbatim, and the best measurement of the day

This worktree's remote carries **userinfo**:

```
git config --get remote.origin.url  →  https://PawanSirsat@github.com/PawanSirsat/Laika.git
heartbeats.repo                     →  https://PawanSirsat@github.com/PawanSirsat/Laika.git
GET /presence project_ids           →  ["01M1ED2YGSB997BV64EWJM22KK"]   (repo: PawanSirsat/Laika)
```

Sent byte-for-byte and resolved server-side, alongside the scp form from a
scratch repo. **D-043 working on a shape no plugin author would have thought to
normalise** — which is the argument that decided it.

### Three defects the tests found, and one they caused

**`git rev-parse --abbrev-ref HEAD` exits 128 on a repository with no commit and
still prints `HEAD` on stdout.** `|| true` swallows the failure and leaves a
plausible value behind, so the board would have been told the branch was called
`HEAD`. **The mandatory fail-silent is what makes a wrong value invisible.**
`git branch --show-current` gives the real name on an unborn branch and nothing
on a detached HEAD, which is the case that should be skipped.

**The token was in `argv`.** §8's snippet uses `-H "Authorization: Bearer …"`,
which is readable in `ps` by every other user on the machine, several times an
hour. It goes in on stdin via `curl --config -`. The README already said "no
secret on the command line"; curl's command line is still a command line.

**I committed a file with a mutation still in it.** A harness was killed between
applying its edit and its `finally`, and **`git status` cannot show a
modification to an untracked file** — `??` looks the same either way.

**And the one the tests caused: a red suite hung instead of failing.** Every stub
board was closed on the last line of its test, so it was closed only when the
test *passed*; a throwing assertion skipped the close, the handle held the event
loop, and `node --test` never exited. It hung the root gate once and two mutation
runs, always with a real failure underneath, and every time it read as slowness.
Closed centrally now and `unref`'d: **600s+ → 10s**, failing on the right
assertion.

### Mutation coverage

Eleven, all red, anchors checked and printed:

| Mutation | Red |
| --- | --- |
| unconfigured stops being silent | `unconfigured is silent, not broken` |
| the remote reduced to a basename | `what goes on the wire` |
| branch back to `rev-parse --abbrev-ref` | `nothing to report is not an error` |
| throttle removed / stops keying on branch | `the throttle` |
| SessionStart throttled like the rest | `the throttle` |
| token back on curl's `argv` | `the token stays out of argv` |
| curl loses its timeouts | `a board that is down must not break the session` |
| escaping dropped | `what goes on the wire` |
| a command loses its `|| true` | `hooks.json` |
| `Stop` unregistered | `hooks.json` |

**Two anchors failed to land and said so loudly**; both were re-run by hand
rather than counted as caught.

---

## Accepted — CHIEF, 2026-09-02. **M4's exit criterion is met.**

Root gate `EXIT 0`, zero lines matching `Unhandled|Errors|Failed|not ok` —
1701 server, 585 web, **49** cli. Verified by exit code.

**Checked directly rather than from the report:** `repo` is
`git config --get remote.origin.url` unparsed; `|| true` on all three hooks;
`hooks.json` carries `SessionStart`, `PostToolUse` and `Stop`; the README states
the exact form with an example and no longer says *"empty by design"*; no
`lai_`-prefixed string anywhere in `plugin/` or `cli/`.

### The two criteria I said would be assumed rather than tested

**Four heartbeats from one session** with the throttle stamp held clear —
SessionStart, two PostToolUse, Stop — and **one** from the identical session with
the stamp left alone. *"The stamp had to be manipulated from outside to see the
other three at all, which is the design rather than a workaround."*

**Dead port: exit 0, 14s against 12s configured**, plus `127 → 0` for the layer
the script cannot cover itself. **Unconfigured: exit 0, zero bytes.**

All through `--plugin-dir`, against your own board on `:3371`. **Nothing in the
owner's config or mine was touched**, which was not a criterion and should have
been.

### `failed` is not always `empty` — now in §8

> **`git rev-parse --abbrev-ref HEAD` exits `128` on a repository with no commit
> and still writes `HEAD` to stdout.** `|| true` swallows the status, `$(…)`
> keeps the output, and the board is told the branch is called `HEAD`.

**§8's mandatory fail-silent is what makes a plausible-but-wrong value
invisible**, and the general form is in the spec with the git case as its
example: `|| true` around anything that prints on failure has the same hole.
`git branch --show-current` gives the real name on an unborn branch and gives
**nothing** on a detached `HEAD` — the case that should be skipped.

### The hang is the better lesson and it is the one you volunteered

> *"Every stub board was closed on the last line of its test — so it was closed
> **only when the test passed**. A throwing assertion skipped the close, the open
> handle held the event loop, and `node --test` never exited… **and every time I
> read it as slowness.**"*

**A hang is the one failure mode that looks like patience.** It hung the root
gate once and two mutation runs, always with a real failure underneath. Closed
centrally and `unref`'d at creation; the mutation that hung past 600s now fails
in **10s on the right assertion**.

**Three instruments, one shape, one day** — `git status` blind to an untracked
edit, a pass-count grep blind to `Errors 1 error`, and a suite that could not
fail without hanging. **Each fix was a different instrument rather than more
care**, which is the sentence I would keep out of all of today's.

**Eleven mutations, all red. Two anchors failed to land, said so loudly, and were
re-run by hand rather than counted.**
