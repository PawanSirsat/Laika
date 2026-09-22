---
id: LAI-483
title: The installer and launcher have no test surface — three defects reached the owner
area: plugin
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-482
status: done
finished: 2026-09-22T08:36:28Z
started: 2026-09-22T08:34:02Z
---

## Goal

`plugin/scripts/install.sh` and `plugin/scripts/laika-claude` are executed by
every teammate onboarding to Laika, and **nothing in any workspace runs them.**
`cli/test/` covers the plugin's manifest, hooks, commands and MCP wiring; the
two scripts a person actually types are untested.

**Three defects have reached the owner in three days**, all in these two files,
none catchable by reading:

| | defect | how it presented |
| --- | --- | --- |
| LAI-615 | the command was a shell **alias** | `zsh: command not found`, in the terminal they had open |
| LAI-616 | `dirname "$0"` through a symlink | `--plugin-dir ~/.local`, **exit 0**, no plugin loaded |
| LAI-482 | the same defect, twice more | an installer hint naming a path with no installer; a **dangling** symlink |

Two is a coincidence. Three is this task.

**Every one was found by a human hitting it.** Each was also reproducible in a
sandbox in under a minute once someone thought to try — which is the argument:
the cost here is not difficulty, it is that nobody had a place to put the test.

## Acceptance criteria

- [x] A test in `cli/test/` runs **`install.sh` end to end in a sandbox `HOME`**,
      non-interactively, and asserts: the symlink is created in a PATH
      directory, it **resolves to an existing file**, and `~/.laika/env` is
      mode `600`.
- [x] A test runs **`laika-claude` through that symlink** with a stub `claude`
      on `PATH`, and asserts `--plugin-dir` is the **real checkout** and that
      user flags survive **in order** after it.
- [x] The **unconfigured** path is asserted: no `~/.laika/env`, invoked through
      the symlink, and the installer hint names a path that **exists**.
- [x] **A negative control is kept as a fixture and asserted to FAIL.** A copy
      of the pre-fix launcher (the `dirname "$0"` form) must produce the wrong
      path, and the test must assert that it does. Without this the suite can go
      green against a harness that resolves nothing — the exact shape CLAUDE.md
      §5 keeps describing, and the reason all three defects above were provable.
- [x] No test writes outside its sandbox `HOME`. These scripts append to shell
      rc files and create symlinks; a test that touches the real `$HOME` is a
      worse bug than the ones it catches.

## Notes / context

- **The harness already exists** — CHIEF built it twice while reviewing LAI-616
  and LAI-482, and both reviews turned on it. It is roughly twenty lines: a
  temp dir as `HOME`, a plugin checkout, a stub `claude` that echoes `$*`, a
  symlink, and `env -i` to keep the real environment out. Its shape is in the
  accept notes on both tasks.
- `cli/`'s runner is `node --test "test/**/*.test.ts"`, so this is a
  `node:test` file like its neighbours, shelling out with `execFile`.
- `install.sh` reads two values from stdin; a heredoc drives it. Note it skips
  the `stty` block when stdin is not a TTY, which is what makes this possible.
- **Do not assert on message wording.** Assert the resolved paths and the exit
  codes; the prose in these scripts is expected to keep changing.
- `laika-common.sh`, `laika-setup.sh`, `laika-standup.sh` use `BASH_SOURCE`
  correctly and are never placed on `PATH` — out of scope unless that changes.

---

## Accepted (CHIEF, 2026-09-22)

All five criteria met. Ten tests, four of them controls.

**I ran the full `cli` suite, which the author flagged as not yet done: 85/85,
exit 0** — 75 before, 10 added, nothing displaced.

**And I mutated it myself**, because a mutation run is the thing you trust
*when the tests pass*, and taking one on report defeats its purpose. Reverted
the live launcher's `SCRIPT_DIR` to the `$0` form:

```
mutation landed?  grep → 2   diff vs original → changed
83/85, 2 failed:  "it hands claude the real plugin directory, and every flag after it"
                  "unconfigured, it names the installer in the checkout and refuses"
restored:         identical, 85/85, exit 0
```

Exactly the two predicted. **I confirmed the mutation landed before believing
the red** — by `grep` *and* by `diff` against a saved copy — which is the
LAI-405 trap, and the one place a mutation harness lies to you.

**The controls are the reason to trust this file, and they are built properly.**
The pre-fix launcher is a literal string fixture, so it cannot rot when history
is rewritten or shallow-cloned. The pre-fix installer is derived by un-fixing the
live file, which keeps it honest as the script changes — and it carries three
guards so it cannot pass vacuously: *the control did not un-fix the resolution*,
*the control did not install anything to inspect*, and *the pre-fix installer
produced a working link — this control proves nothing*. Each names what would
otherwise be a silent pass.

**Containment checked rather than assumed.** `HOME` is a fresh `mkdtemp` per
test and `PATH` is rebuilt from the sandbox plus `/usr/bin:/bin`. These scripts
append to shell rc files and create symlinks; my own `~/.laika/env` and
`~/.zshrc` are untouched after a full run.

Assertions are resolved paths, symlink targets and exit codes. The single string
comparison is the *absence* of `Run the installer` when there is no installer,
which is behaviour rather than prose — correct reading of the criterion.

**This closes the loop that started with my own review of LAI-615.** Three
defects reached the owner because these two files had no test surface. They now
have one, with controls that fail if it ever stops measuring.
