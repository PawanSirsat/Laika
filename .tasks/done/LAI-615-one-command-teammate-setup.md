---
id: LAI-615
title: One-command setup — laika-claude launcher and installer
area: plugin
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-614
status: done
finished: 2026-09-21T09:19:29Z
started: 2026-09-21T09:15:00Z
---

## Goal

A teammate with no Laika checkout and no knowledge of the plugin can connect a
Claude Code session to the board - with live presence - in one command they
can remember. Before this, connecting meant either a raw `claude mcp add` with
a pasted token (no presence, because the heartbeat hooks never load) or a
`--plugin-dir` invocation naming an absolute path that exists only on the
owner's machine, with the owner's own token exported beside it.

## Acceptance criteria

- [x] `plugin/scripts/laika-claude` starts Claude Code with the plugin
      attached, in the caller's own directory, passing every flag through
      unchanged, and resolves the plugin directory from its own location
      rather than a hardcoded path.
- [x] Settings load from `~/.laika/env` (mode 600) - never from the repo, so
      a token cannot be committed.
- [x] Unconfigured launch fails with an instruction, not a stack trace.
- [x] `plugin/scripts/install.sh` asks for the board URL and the person's OWN
      token, stores them, and installs a `laika-claude` shell command;
      re-running replaces rather than stacks the alias.
- [x] Both scripts pass `sh -n`; the launcher verified end to end against a
      stub `claude` (correct --plugin-dir, flags preserved).

## Notes / context

- Owner-directed, 2026-09-21: "they don't have this root folder ... can we
  make this cmd more good and clear and simple". Claim written at the start of
  the work rather than before it, same deviation shape as LAI-605.
- Deliberately NOT a published marketplace plugin: that is a bigger decision
  (versioning, distribution) and the git-clone route works today.
- Presence needs the plugin's hooks; `claude mcp add` alone can never show a
  session on Capacity. That is the whole reason this exists.

---

## Accepted (CHIEF, 2026-09-21)

Every criterion checked against the scripts themselves, and `sh -n` re-run here
rather than taken from the task file — both exit `0`.

**The secret handling is right, which is the part that mattered most given this
repo is public.** No token literal anywhere in the diff (grepped for
`lai_[A-Za-z0-9]{8,}`). `umask 077` is set **before** the heredoc creates
`~/.laika/env`, so there is no window in which the file exists world-readable
and the `chmod 600` after it is belt-and-braces rather than the only guard.
Nothing is written inside the repository.

### Four findings, none blocking

**1. The token is echoed as it is typed.** `read -r TOKEN` leaves terminal echo
on, so a personal access token lands on screen and in scrollback — during an
onboarding walkthrough that may be shared or recorded, which is the exact
scenario this script exists for. `read -s` is not POSIX; `stty -echo` / `stty
echo` around the read is.

**2. The default board URL is plain HTTP** — `http://52.72.203.206`. Every
teammate onboarded this way sends a personal token over the network in
cleartext as a `Bearer` header. SPEC §11 anticipates this — *"TLS is somebody
else's job — `docker/Caddyfile.example` ships as a reference"* — so the
architecture is not at fault; the deployment has not done it, and **this script
is about to make the cleartext path the documented default in a public
repository.** An owner decision, not a code defect.

**3. `cat "$TMP" > "$RC"` rewrites the user's shell rc non-atomically.** An
interruption between truncate and write leaves someone with a truncated
`.zshrc`. Preserving the file's inode and permissions is presumably why `mv`
was avoided, and that is a real reason — but the failure mode is losing a
person's shell configuration.

**4. One `echo "\nNo token given…"` in a `#!/bin/sh` script.** `echo` does not
portably interpret `\n`; on `dash` this prints a literal backslash-n. Every
other message in the file correctly uses `printf`.

**Recorded rather than fixed**: CHIEF writes no code, and none of the four stops
the scripts doing what their criteria claim. 1 and 2 are worth the owner's
decision before this is handed to teammates; 3 and 4 are small.

## Follow-up after acceptance (CHIEF, 2026-09-21)

Three of the four findings above are fixed in `a79dae5` (committed under
LAI-481's id, declared rather than hidden):

- **Terminal echo is off while the token is typed** — `stty` rather than
  `read -s`, which is not POSIX. Guarded by `[ -t 0 ]`, state saved with
  `stty -g`, a `trap` on `EXIT INT TERM` restoring it if the person hits
  Ctrl-C at the prompt, explicit restore and `trap -` after, and a `printf '\n'`
  for the newline the suppressed Enter no longer echoes. Careful work.
- **The non-portable `echo "\n…"` is now `printf`.**
- **The shell rc is copied to `$RC.laika-backup` before the in-place rewrite**,
  and the inode-preservation reason for `cat >` over `mv` is now written down —
  which was the actual reason, now recorded rather than inferred. The success
  line names the backup.

`sh -n` re-run on the amended script: `0`.

**Finding 2 — the plain-HTTP default — is not fixed and should not have been
by a builder.** It is with the owner as a decision: a domain with HTTPS now, or
ship the pilot with an explicit warning. It stays open here so that choice is
visible rather than closed by silence.
