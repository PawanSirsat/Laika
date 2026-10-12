# cli/ — owned by **Builder-B**

The `laika` CLI (`laika init`, `laika whoami`, `laika connect`). Installed on
PATH by `plugin/scripts/install.sh` from a Laika checkout.

If you need a change here, write a task file in `.tasks/backlog/` with
`area: cli`.

## `laika connect <agent>`

Points a coding agent at the board's MCP endpoint (`<LAIKA_URL>/mcp`).

```bash
laika connect --list            # every agent, and what connect does for it
laika connect cursor            # user scope: ~/.cursor/mcp.json
laika connect cursor --project  # this folder: .cursor/mcp.json
laika connect omnigent --dir ./my-agent
```

**Credentials.** It reuses `~/.laika/env` when that holds both `LAIKA_URL` and
`LAIKA_TOKEN`. Otherwise it takes both from the environment, or asks for the
URL and then the token — the same order as `install.sh`, so piped answers work.
It then writes `~/.laika/env` in `install.sh`'s format (directory 0700, file
0600). The token is never printed.

**Environment.** Most clients read the token from `LAIKA_TOKEN`, so connect
appends one block, once, to the rc file `install.sh` would pick from `$SHELL`
(`~/.zshrc`, `~/.bashrc`, else `~/.profile`). It loads `~/.laika/env`. Open a
new terminal afterwards. GUI apps such as Cursor and VS Code inherit the
variable only when you start them from that terminal (`cursor .`, `code .`).

**What it writes.** Codex, Cursor, Gemini CLI, OpenCode, Antigravity, Omnigent
(with `--dir` or `--project`), and Claude Code and VS Code with `--project`.
Every other agent gets a snippet printed for it. Those files refer to the
variable in each client's own syntax and hold no token. The exception is
**Antigravity**: it has no env-var expansion, so the token is written inline
to `~/.gemini/config/mcp_config.json` (0600). `--project` is refused for
Antigravity, because a project file can be committed.

**Other people's files.** Connect only touches the `laika` entry. A file that
is not valid JSON (including JSONC with comments) is refused, and nothing at
all is written. The first time connect changes an existing file, it saves the
original once and never overwrites that backup: beside a user-scope file as
`<file>.bak`, and under `~/.laika/backups/` for a project file, so no backup
lands in a repository. If the entry is already the same, connect writes
nothing. If a Codex config already defines the `laika` server in any form (a
`[mcp_servers.laika]` table, an inline table or a dotted key), connect leaves
the file alone; if it mentions `laika` in a way connect cannot place, it also
leaves it alone and prints the block for you to add.

**Credentials.** `LAIKA_URL` and `LAIKA_TOKEN` in the environment win over
`~/.laika/env` and update it. A file holding the token (`~/.laika/env`,
Antigravity's config) is written through a 0600 temp file and a rename, so it
never holds the token under a wider mode. The shell rc only *sources*
`~/.laika/env`; it never contains the token.

`laika whoami` prints an `Agents` line naming which agents have a `laika` entry
at user scope. It only checks that the entry exists, not that it works.
