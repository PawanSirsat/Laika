# Laika — Claude Code plugin

Points a Claude Code session at a self-hosted [Laika](../README.md) board so an
agent reads ready tasks, claims work, comments, and hands it back for review —
through the same MCP endpoint and the same `can()` permissions a human gets in
the browser.

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

## What is not built yet

| | Milestone | Waiting on |
| --- | --- | --- |
| MCP tools (`list_ready_tasks`, `start_working`, …) | M3 | the `/mcp` endpoint — SPEC §4 |
| Heartbeat hooks | M4 wiring / M5 endpoint | `POST /api/v1/heartbeats` — see [LAI-013](../.tasks/) |
| Agent protocol skill | M4 | — |
| `/laika:setup`, `/laika:tasks`, `/laika:standup` | M4 | tokens (M3), CLI (M4) |
| `npx laika init` | M4 | `cli/` — not started |

Declaring the MCP server now is intentional: it fails to connect until a board
exists, which is the correct behaviour and costs nothing.

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
