---
id: LAI-482
title: The launcher's "not configured" message still uses the unresolved $0
area: plugin
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-616
status: review
finished: 2026-09-22T08:28:51Z
started: 2026-09-22T08:28:14Z
---

## Goal

LAI-616 fixed `dirname "$0"` where it derived `PLUGIN_DIR`. **The identical
defect survives sixteen lines above it**, in the message a person sees when
`~/.laika/env` is missing:

```sh
echo "  Run the installer:  $(dirname "$0")/install.sh" >&2
```

That runs **before** the `readlink` loop resolves `SELF`, so installed on PATH —
which is now the default — `$0` is the symlink and the line names
`~/.local/bin/install.sh`. **There is no installer there.**

Measured in a sandbox HOME, launcher invoked through the symlink with
`~/.laika/env` removed:

```
laika-claude: not configured yet.
  Run the installer:  /…/home/.local/bin/install.sh     ← does not exist
  Or set LAIKA_URL and LAIKA_TOKEN in /…/home/.laika/env
```

**Who hits it.** Not someone whose install worked — they never see this. It is
the person who runs `laika-claude` before installing, or whose settings were
removed: exactly the person with least context, handed a path with nothing at
it. The second line is still correct and is the reason this is a papercut
rather than a wall.

## Acceptance criteria

- [x] The message names the **real** installer path when the launcher is
      invoked through a symlink on PATH.
- [x] Verified by **running it through a symlink** with `~/.laika/env` absent,
      not by reading the script — the whole class of bug here is that reading
      does not show it (LAI-616 was found the same way).
- [x] The fix does not reintroduce the ordering trap: whatever resolves the
      path must run **before** any message that prints it. Moving the existing
      `readlink` loop above the configuration check is the obvious shape, and
      it also means one resolution serves both uses.
- [x] A missing `install.sh` beside the resolved launcher is not claimed to
      exist — say where it should be, or say the checkout is incomplete.

## Notes / context

- One line, and the ordering is the whole of it: the resolution happens at
  line 39 and the message at line 27.
- **Worth reading the rest of the file for the same shape before closing this.**
  Two instances of one bug in one script, in one review, is the signal to sweep
  rather than patch — `grep -n 'dirname "\$0"' plugin/scripts/*` is the sweep,
  and it must not end in a `head` (CLAUDE.md §5).
