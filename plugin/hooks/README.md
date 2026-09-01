# plugin/hooks/ — session hooks

`hooks.json` is declared by the `hooks` field of `.claude-plugin/plugin.json`
and registers one script, `heartbeat.sh`, on three events (SPEC §8):

| Event | Argument | Throttled |
| --- | --- | --- |
| `SessionStart` | `session-start` | no |
| `PostToolUse` | `tool-use` | yes — at most one post per 5 minutes |
| `Stop` | `stop` | yes — the same 5 minutes, shared |

Each POSTs `{ repo, branch }` to `$LAIKA_URL/api/v1/heartbeats` with
`Authorization: Bearer $LAIKA_TOKEN`. That is the whole of it. **Metadata
only** (D-005): never file contents, never a diff, never a prompt.

## What `repo` is

**The output of `git config --get remote.origin.url`, sent verbatim.** Not the
basename, not `owner/name`, not stripped of `.git`. If git printed it, it goes
on the wire unchanged:

```
git config --get remote.origin.url   →  git@github.com:PawanSirsat/Laika.git
sent                                 →  {"repo":"git@github.com:PawanSirsat/Laika.git","branch":"shell"}
stored by §4.3                       →  PawanSirsat/Laika
```

**The server normalises, the plugin does not** (D-043, §9.1). `owner/name`,
`git@host:owner/name.git`, `https://host/owner/name`, `ssh://` and `git://`,
with or without `.git` or a trailing slash, all resolve to `owner/name` on the
server side — and so does a project row that stores a URL.

This sentence used to read *"metadata only — git remote basename"*, and that is
the sentence that produced **LAI-144**: a basename is `Laika`, which matches
nothing §4.3 stores, so every heartbeat would have resolved to no project and
presence would have been permanently empty. SPEC §8 said it too. Both are fixed.
If you are implementing a second client, the paragraph above is the contract.

`branch` is `git branch --show-current` — likewise unparsed. §9.2 reads a task
id out of it server-side, for the same reason: the plugin cannot know a
deployment's project prefixes.

**Not `git rev-parse --abbrev-ref HEAD`.** In a repository with no commit yet
that exits `128` and prints `HEAD` on stdout anyway, so `|| true` swallows the
failure and leaves a plausible-looking branch behind; on a detached HEAD it
prints `HEAD` as though that were a branch name. `--show-current` reports the
real name on an unborn branch and reports **nothing** when there is genuinely no
branch — and nothing means the post is skipped, which is what §9.1 wants, since
`branch` is a required field and an empty one is a `422`.

## Rules that are not negotiable

- **Fail silent (§8).** *"A board that is down, slow, or unreachable must never
  break a coding session."* The script has no `set -e`, ends in `exit 0`, and
  prints nothing on any path. Every command in `hooks.json` also ends in
  `|| true` — that is not decoration, it is the layer that covers the script
  being missing, unreadable or not executable, which the script cannot cover
  itself. `timeout: 5` bounds the script, and curl is bounded separately at
  `--connect-timeout 2 --max-time 3`.
- **Unconfigured is silent, not broken.** With `LAIKA_URL` or `LAIKA_TOKEN`
  absent the hooks do nothing and say nothing. Most repositories on most
  machines have never heard of Laika, and a warning on every session start in
  every one of them is a defect.
- **No secrets on the command line.** `LAIKA_TOKEN` is read from the
  environment inside the script, never interpolated into `hooks.json` — and
  never passed to curl in `argv` either, because argv is readable in `ps` by
  anyone else on the machine. It goes in on stdin via `curl --config -`.
- **No parsing of the remote.** See above. Do not add a `sed`.

## Configuring it

`npx laika init` writes `LAIKA_URL` and `LAIKA_TOKEN` into the `env` block of
`~/.claude/settings.json` (D-046), which Claude Code exports into the
environment the hooks run in. `/laika:setup` is a front door to the same thing.
Nothing is written into the repository, and nothing here is committed.

## Debugging

Presence being empty is the failure this causes, and it is invisible by design.
Set `LAIKA_HEARTBEAT_DEBUG=1` to make the script report on stderr which branch
it took — not configured, no remote, throttled, or sent. **It never prints the
token.**

```
$ LAIKA_HEARTBEAT_DEBUG=1 plugin/hooks/heartbeat.sh session-start
laika heartbeat: sent (session-start) repo=git@github.com:PawanSirsat/Laika.git branch=shell
```

If it says `sent` and the board shows nothing, the request itself failed —
silently, as intended. Re-run the same POST by hand with curl to see the status.

## Tests

`cli/test/plugin-hooks.test.ts`, in the `laika` CLI package because `plugin/`
has no workspace entry of its own and a test outside the workspace does not run
in the gate (**LAI-230**). They drive this script as a subprocess: against a
stub board, against a dead port, unconfigured, outside a repository, and with a
fake `curl` on `PATH` that records its own `argv`.
