---
id: LAI-616
title: laika-claude installs on PATH, and survives being a symlink
area: plugin
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-615
status: done
finished: 2026-09-22T08:20:32Z
started: 2026-09-22T08:15:00Z
---

## Goal

`laika-claude` works the moment the installer finishes, in the terminal the
person already has open. LAI-615 installed it as a shell alias, and the owner
hit `zsh: command not found: laika-claude` twice in a terminal opened before
the alias existed - an alias only exists in interactive shells that have
sourced the rc since it was added. A symlink in a PATH directory has none of
those conditions.

The symlink then exposed a second defect: the launcher derived the plugin
directory from `dirname "$0"`, which through a symlink names the symlink's own
directory. Measured: `--plugin-dir /Users/…/.local` - a path that does not
exist, passed to claude without comment.

## Acceptance criteria

- [x] The installer prefers a symlink in the first writable PATH directory
      (`~/.local/bin`, `~/bin`, `/usr/local/bin`), creating `~/.local/bin` and
      adding it to PATH when none qualifies, and keeps the alias only as the
      fallback for a machine with no writable candidate.
- [x] The launcher resolves symlinks before deriving the plugin directory -
      a `readlink` loop, since BSD `readlink` has no `-f`.
- [x] A missing or moved plugin fails with a named message, not a silent
      `--plugin-dir` pointing at nothing.
- [x] Verified in a sandbox HOME end to end: installer run non-interactively,
      symlink created, `~/.laika/env` at mode 600, and the launcher invoked
      THROUGH the symlink resolves the real plugin directory and passes flags.

## Notes / context

- Owner-directed fix, 2026-09-22; claim written at the start of the work.
- The owner's own machine was fixed by hand first (symlink + patched launcher)
  because they were blocked; this task is what makes it true for everyone else.

---

## Accepted (CHIEF, 2026-09-22)

**Verified by running it, not by reading it** — which is the only review that
could have caught the defect this task fixes, and is the lesson I am taking from
having accepted LAI-615 without doing so.

Built a sandbox `HOME` with a plugin checkout and a stub `claude` that reports
its arguments, ran the installer non-interactively, and invoked the launcher
**through the created symlink**:

```
STUB-CLAUDE-ARGS: --plugin-dir /…/sandbox/checkout/plugin --dangerously-skip-permissions --model opus
```

The real plugin directory, with both user flags passed through in order.
`~/.laika/env` came out `-rw-------`, and the symlink points at the launcher in
the checkout.

**Then I reproduced the shipped defect to prove the test exercises the path** —
the same symlink, the launcher as it stands on `master`:

```
STUB-CLAUDE-ARGS: --plugin-dir /…/sandbox/home/.local --model opus     EXIT 0
```

A directory that is not the plugin, handed to `claude`, **exit 0**. A green run
doing nothing. Without that second measurement the first one proves only that
something printed.

**AC3 behaves in two different ways and both are acceptable.** With the plugin
manifest removed but the launcher reachable, the guard fires by name and exits
`1`. With the whole checkout moved the symlink dangles and the OS refuses first
— `No such file or directory`, exit `127` — so the named message never runs.
That is the operating system being clearer than the script could be, not a gap.

### One finding, filed rather than added here

The **`dirname "$0"` defect survives sixteen lines above the fix**, in the
"not configured yet" message, which runs before the `readlink` loop. Through the
symlink it printed `Run the installer: /…/home/.local/bin/install.sh` — a path
with no installer at it.

Not failed against, because §2 freezes criteria once work is submitted and no
criterion here covers it. Filed as **LAI-482** (p1) instead, with the
measurement and the ordering fix. Two instances of one bug in one script is a
reason to sweep the file rather than patch the line, and LAI-482 says so.
