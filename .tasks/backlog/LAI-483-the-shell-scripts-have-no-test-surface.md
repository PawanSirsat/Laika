---
id: LAI-483
title: The installer and launcher have no test surface — three defects reached the owner
area: plugin
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-482
status: backlog
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

- [ ] A test in `cli/test/` runs **`install.sh` end to end in a sandbox `HOME`**,
      non-interactively, and asserts: the symlink is created in a PATH
      directory, it **resolves to an existing file**, and `~/.laika/env` is
      mode `600`.
- [ ] A test runs **`laika-claude` through that symlink** with a stub `claude`
      on `PATH`, and asserts `--plugin-dir` is the **real checkout** and that
      user flags survive **in order** after it.
- [ ] The **unconfigured** path is asserted: no `~/.laika/env`, invoked through
      the symlink, and the installer hint names a path that **exists**.
- [ ] **A negative control is kept as a fixture and asserted to FAIL.** A copy
      of the pre-fix launcher (the `dirname "$0"` form) must produce the wrong
      path, and the test must assert that it does. Without this the suite can go
      green against a harness that resolves nothing — the exact shape CLAUDE.md
      §5 keeps describing, and the reason all three defects above were provable.
- [ ] No test writes outside its sandbox `HOME`. These scripts append to shell
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
