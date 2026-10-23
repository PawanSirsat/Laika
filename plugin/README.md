# Laika — Claude Code plugin

Points a Claude Code session at a self-hosted [Laika](../README.md) board so an
agent reads ready tasks, claims work, comments, and hands it back for review —
through the same MCP endpoint and the same `can()` permissions a human gets in
the browser.

**Using another coding agent?** Codex, Cursor, Gemini CLI, OpenCode, VS Code,
Antigravity, Omnigent and the rest connect to the same `/mcp` endpoint without
this plugin. The board's **Connect** page shows the exact config for each, and
`laika connect <agent>` (`laika connect --list` for the names) writes it for you
after `plugin/scripts/install.sh` has stored the board and token (LAI-737). This
plugin adds what only Claude Code can load: the `/laika:*` commands and the
heartbeat hooks.

> **Status: skeleton (LAI-012).** The manifest, the MCP declaration, and one
> working command are here. The MCP tools themselves land in M3 and the hooks,
> skills, and remaining commands in M4. See [What is not built yet](#what-is-not-built-yet).

## Layout

```
plugin/
  .claude-plugin/plugin.json   manifest — name, version, declared components
  .mcp.json                    the Laika MCP server, over HTTP
  commands/                    slash commands        → /laika:status today
  hooks/                       heartbeat hooks       → empty until M4
  skills/                      agent-facing skills   → empty until M4
  scripts/                     helper scripts the commands shell out to
```

Each directory has its own README saying what fills it and when.

## Install locally

The plugin is not published to a marketplace yet. Load it straight from a
checkout:

```bash
claude --plugin-dir /path/to/Laika/plugin
```

That loads it for one session only, which is what you want while it is still a
skeleton. Confirm it worked:

```
/laika:status
```

To check the manifest after editing it:

```bash
claude plugin validate /path/to/Laika/plugin
```

## Configure

Two environment variables, both read from the environment Claude Code starts
in. Neither is ever written to a file in this repo.

```bash
export LAIKA_URL="https://laika.example.com"   # your deployment, no trailing slash
export LAIKA_TOKEN="lai_..."                   # Settings → Tokens on that board
```

| Variable | Required | What it is |
| --- | --- | --- |
| `LAIKA_URL` | yes | Base URL of your Laika deployment. The plugin appends `/mcp`. |
| `LAIKA_TOKEN` | yes | A personal access token, format `lai_<40 chars>`. Shown **once** when minted. |

Restart Claude Code after setting them — the MCP server reads them at load time.

`.mcp.json` references both as `${LAIKA_URL}` / `${LAIKA_TOKEN}` placeholders
that expand at runtime. **No token is committed to this repository, ever.** If
you find a literal `lai_` value in a tracked file, treat it as leaked: revoke it
on the board and rotate.

## Running unconfigured

The plugin loads normally with neither variable set. It does not error, and it
does not need to be uninstalled while you are between boards — the MCP server
simply has nothing to reach, and `/laika:status` says so and tells you which
variables to set.

`/laika:status` never prints your token. It reports only that one is present,
whether it carries the expected `lai_` prefix, and its length — enough to catch
a truncated paste, not enough to be worth stealing.

## Silence when unconfigured is deliberate

Measured against a real session with neither variable set (LAI-419): Claude Code
starts, the session runs, and **nothing is printed at all** — no warning, no
connection error, no mention of the MCP server.

That is the intended behaviour and not merely what happens to occur. The only
lever a plugin has for saying something unprompted is a `SessionStart` hook,
which fires in **every repository you open** — and a plugin that announces itself
in every repository that has never heard of Laika is the defect
[LAI-418](../.tasks/)'s criteria name for the heartbeat. This repo has already
decided that question once, in this direction.

So the message exists and you pull it: **`/laika:status`** names both variables
and how to set them, and it never prints your token.

## What is built

| | Status |
| --- | --- |
| MCP tools — **eighteen**, §7.1 | ✅ served at `${LAIKA_URL}/mcp` |
| Heartbeat hooks | ✅ LAI-418 — `SessionStart`, `Stop`, throttled `PostToolUse` (per session, 90 s — LAI-752) |
| Local activity hooks | ✅ LAI-752 — `scripts/laika-activity-hook`, installed by `laika activity on`; automated sessions skipped (LAI-757) |
| `laika init` | ✅ LAI-422 — writes both variables to `~/.claude/settings.json` |
| `/laika:status` | ✅ |
| `/laika:setup`, `/laika:tasks`, `/laika:standup` | LAI-420 |
| Agent protocol skill | LAI-421 |

**Eighteen tools since LAI-611** (eleven before it). §7.1's table and
`server/src/mcp/` agree at eighteen; smaller stale counts have appeared in task
files and in `CLAUDE.md`, and the count is asserted in
`cli/test/plugin-mcp.test.ts` against the spec and the registry so the next drift
is loud rather than repeated.

## Local activity (LAI-752)

`scripts/laika-activity-hook` counts prompts and agent sessions on this machine
for the profile's activity heatmap. **Collection is the organisation's**
(D-102 amended): nothing is collected unless its Developer insights is on, and
while it is, every connected machine is — there is no personal switch. A token
cannot turn it on, so no agent can switch on its own reporting. `laika activity
on` installs the hook into each agent's own config (see `cli/README.md`) and
says plainly what is collected, that the owner and anyone they grant access can
see it, and that you can see who looked; `laika activity off` removes it from
this machine.

It is **not** in `hooks/hooks.json`. Claude Code runs a plugin's hooks and the
settings file's hooks both, so registering it here as well would count every
prompt twice for anyone who uses `laika-claude`. `laika activity on` puts it in
`~/.claude/settings.json`, which serves plain `claude` and `laika-claude` alike.

| Mode | Fired by | Does |
| --- | --- | --- |
| `prompt` | prompt submit | appends `p <agent> <epoch>` to `~/.laika/activity/events.log`; for an Omnigent orchestrator's turn, `t omnigent <epoch> <session>` instead (LAI-792), or `w` when Omnigent started it (D-090); nothing for a notice Omnigent typed into a Claude Code primary |
| `session-start` | session start | appends `s <agent> <epoch>`; remembers the repo's top level in `~/.laika/activity/repos`; starts a detached `laika activity sync` if one is due |
| `session-end` | session end | starts a detached `laika activity sync` if one is due, and returns at once |
| `turn-end` | Claude Code's `Stop`, every turn's end (LAI-776) | counts nothing — but an Omnigent orchestrator's turn end, `r omnigent <epoch> <session>` (LAI-792); while collection is on, starts a detached `laika activity sync` if one is due — so a long session's tokens arrive within one sync interval. Not due, under zsh it forks nothing |

What it never does:

- **Keep, store or send any part of the prompt.** Stdin is drained to
  `/dev/null`, and `$USER_PROMPT` (Kiro) is unset first. **On an Omnigent
  turn only** (D-090) — Claude Code's prompt on an Omnigent orchestrator's
  turn or in an Omnigent primary — it reads the first 4 KB into a variable to
  check one thing, whether the prompt begins with Omnigent's `[System: `
  marker, then clears it and drains the rest. Every other prompt never lands
  in a variable. A test sends a prompt carrying a unique marker, on the
  Omnigent paths too, and asserts it is in no file under `HOME`.
- **Print.** Claude Code feeds `UserPromptSubmit` output to the model, and
  exit 2 blocks the prompt in four agents — on `Stop` it keeps Claude from
  stopping: stdout and stderr go to `/dev/null` and every path exits 0.
- **Read a reply.** `Stop`'s payload carries the turn's last reply
  (`last_assistant_message`); `turn-end` drains it like a prompt and keeps
  nothing of it.
- **Cost time.** Under `/bin/zsh -f` (what `on` installs wherever zsh exists)
  the prompt path forks nothing — zsh's own `EPOCHSECONDS` and `sysread` — and
  measures about 4 ms against about 3 ms for the bare interpreter. Under
  `/bin/sh` it takes one `cat` and one `date`. No network, git or node.
- **Count anything while Developer insights are off for your organisation.**
  Every mode is a no-op unless `~/.laika/activity/state.json` says
  `"collect":true`, which only the sync writes, from the board's answer.
- **Count Devin CLI as Claude Code.** Devin CLI also runs the hooks in
  `~/.claude/settings.json`; it sets `DEVIN_PROJECT_DIR`, and the hook counts
  nothing for `claude-code` when that is set.
- **Count a session nobody is typing in** (LAI-757, D-080). With `OMNIGENT=1`
  (Omnigent sets it in every process it launches), a non-empty `CI` or a
  non-empty `LAIKA_ACTIVITY_SKIP`, every mode drains stdin and exits before
  reading `state.json`: no event, no repo, no sync. Under zsh that path, like
  the prompt path, needs no external command. **It keeps one thing**
  (LAI-775): from the session-start and session-end payloads only — never a
  prompt's — a `"session_id"` that is a plain id, appended to
  `~/.laika/activity/skip-sessions`, so `laika activity sync` sends that
  session's tokens marked automated — the team's, never the person's (D-091).
  Never sent. For a sub-agent an Omnigent runner dispatched it keeps one
  thing more (LAI-314): at its start, its repository's top level, appended to
  `~/.laika/activity/dispatched-repos`, 0600, never sent — found with shell
  builtins alone, and never written to `repos`. The time drafter counts your
  commits there as ticks on My day's signals lane: no minute, no card, and
  never on the heatmap.
- **Skip the session the person types to** (D-088 item 9, LAI-787). Omnigent
  sets `OMNIGENT=1` on its primary session too. When
  `OMNIGENT_TERMINAL_LAUNCH_SESSION_ID` equals `OMNIGENT_RUNNER_PRIMARY_SESSION_ID`
  (both set), the session is the runner's primary — the conversation the
  person types in — and counts as theirs; its id is kept, 0600 and never sent,
  in `~/.laika/activity/primary-sessions`. A notice Omnigent types into a
  Claude Code primary itself (a sub-agent finishing, a timer, an idle
  terminal) begins `[System: ` and writes no `p` (D-090). A dispatched
  sub-agent's two ids differ, and it is skipped as above. `CI` and
  `LAIKA_ACTIVITY_SKIP` still skip it.
- **Skip an Omnigent-native orchestrator's turns** (LAI-792, D-090). polly
  thinks with Claude Code under the Claude Agent SDK, which loads
  `~/.claude/settings.json`, so this hook runs at each of its turns — in a
  runner the Omnigent host launched for a `claude-sdk` session
  (`OMNIGENT_RUNNER_LAUNCH_HARNESS=claude-sdk`), with
  `CLAUDE_CODE_ENTRYPOINT=sdk-py` (not `claude -p`'s `sdk-cli`), in no
  terminal, for `claude-code`. A turn the person started appends
  `t omnigent <epoch> <session>` to `events.log`; one Omnigent started itself
  — its prompt begins `[System: ` — appends `w`; every turn's end appends `r`,
  and `laika activity sync` drops the `r` that closes a `w`. The session is
  `OMNIGENT_RUNNER_PRIMARY_SESSION_ID`, a plain id or nothing is counted; its
  start keeps that id in `primary-sessions`. Never a `p` line. No
  session-start payload is read and no session start or repo is recorded.
  Under zsh a turn's start, marker check included, forks nothing, and so does
  its end unless a sync is due.

`~/.laika/activity` is 0700 and its files 0600. Repo paths, the event log and
extra emails stay there; only per-day counts and one-way commit keys are sent.

## Working on this plugin

Two checks, both run from the repo root, both required before moving a task to
review (CLAUDE.md §5):

```bash
pnpm format                          # Prettier — covers every .json/.yaml here
claude plugin validate plugin        # manifest, commands, skills
```

The repo-wide `format` glob already reaches into `plugin/`, dot-directories
included — a misformatted `.claude-plugin/plugin.json` or `hooks/*.yaml` fails
the check for the whole repo. There is **no pre-commit hook**: running it is on
you. `pnpm format:fix` rewrites the entire repo, so from this directory prefer

```bash
npx prettier --write "plugin/**/*.{json,yaml,yml,js,ts,css,html}"
```

which stays inside Builder-B's area.

Prettier's config is the shared `/.prettierrc`. Do not add a second one here.

## Ownership

`plugin/` belongs to **Builder-B**. Changes here need a task file in
`.tasks/backlog/` with `area: plugin` — see `CLAUDE.md`.

This is the **shipped** plugin, for people who deploy Laika. It is not the
repo-root `.claude/` directory, which configures the three sessions that build
Laika. They are unrelated.
