# Harness capability matrix (LAI-557)

What `laika agent` can do in each harness, cell by cell. The adapters live in
`cli/src/agent-adapters.ts`, one row each, on the shared engine
(`agent-session.ts`, `agent-checkpoint.ts`, `agent-handoff.ts`). The tests are
in `cli/test/agent-adapters.test.ts`, and that file fails if any cell for a
harness that never ran here says **Verified-and-tested**.

**The cells:**

- **Verified-and-tested**: run on Belka on the version shown, against a real
  board.
- **Documented-not-tested**: in the harness's current docs (quoted below), and
  not run here.
- **Unsupported**: the docs say it cannot, or the harness has no such surface.
- **Unverified**: neither documented nor run, so it is unknown.

**Belka, 2026-10-31 (macOS, Darwin 27.2.0, arm64).** What could run:

| Harness | On Belka | Run? |
| --- | --- | --- |
| Cursor | `cursor-agent` 2026.01.28-fd13201; Cursor.app 3.10.17 | **No.** `cursor-agent -p` exits 1: `Authentication required. Please run 'agent login' first`. No hook fired |
| Copilot CLI | not installed (`command -v copilot` is empty) | No |
| Copilot in VS Code | not installed | No |
| Copilot cloud agent | runs on GitHub, not on a laptop | No |
| Gemini CLI | `gemini` 0.49.0 | **No.** `gemini -p` stops at `Opening authentication page in your browser`. No hook fired, `SessionStart` included |
| Antigravity | Antigravity.app 2.0.6, Antigravity IDE.app 2.5.5; no `agy` CLI on `PATH` | No |

Signing in needs the owner in a browser, so it was not done. **No harness in
this file has a Verified-and-tested cell.** Claude Code and Codex are certified
in `cli/README.md` (LAI-542, LAI-547) and are columns here only for comparison.

**Docs read on 2026-10-31, raw pages, grepped rather than summarised:**

- `cursor.com/docs/hooks.md`
- `cursor.com/docs/reference/third-party-hooks.md`
- `cursor.com/docs/cli/headless.md`
- `cursor.com/docs/mcp.md`
- `docs.github.com/api/article/body?pathname=/en/copilot/reference/hooks-configuration`
- `…/en/copilot/concepts/agents/coding-agent/about-hooks`
- `raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/hooks/{index,reference}.md`
- `…/docs/tools/mcp-server.md`
- `…/docs/cli/headless.md`
- `antigravity.google/docs/hooks.md`
- `antigravity.google/docs/mcp.md`
- `antigravity.google/docs/cli/headless.md`
- `…/en/copilot/reference/cli-command-reference`
- `…/en/copilot/how-tos/use-copilot-agents/cloud-agent/extend-cloud-agent-with-mcp`
- `cli.github.com/manual/gh_agent-task_create`

## What every adapter shares

Nothing here is per-harness code. With no verified hooks, an adapter is the
**explicit-command path**, run from the agent's shell tool or the person's
terminal:

```
laika agent login <harness> --url <board> < agent-token       # once; stdin, never argv
laika agent session start --harness <harness> --harness-session <id> --pid <harness pid>
laika agent inbox --harness <harness>                          # work requests and offers
laika agent checkpoint save --harness <harness> --note-file note.json
laika agent handoff prepare|accept <offer> --harness <harness>
laika agent session end --harness <harness> --harness-session <id>
```

`laika agent hooks on --harness <harness>` prints exactly these, writes
nothing, and exits 1. `hooks on` with no harness named installs Claude Code and
Codex only. If a hook is wired by hand (`laika-agent-hook … gemini-cli`), the
entry logs `no verified hook adapter; ignored` and prints nothing. The reason:
its output is Claude Code's shape, and these harnesses read a hook's stdout
differently.

- **Session identity.** The session reports `harness` as the adapter's slug
  (`cursor`, `copilot-cli`, `copilot-vscode`, `copilot-cloud`, `gemini-cli`,
  `antigravity`; SPEC §4.65). The agent is labelled `<harness> · <device>`
  (D-120): *Cursor · Belka*, *Gemini CLI · Belka*, *Copilot cloud agent ·
  Cloud* (D-121).
- **The agent's registered harness** (§4.63) is `cursor`, `gemini-cli`,
  `antigravity` or `vscode` (Copilot in VS Code connects to MCP as *Visual
  Studio Code*). It is `other` for Copilot CLI and the cloud agent, which the
  board has no slug for yet (**LAI-1014**).
- **Binding to the process.** None of these harnesses was seen running here,
  and Gemini CLI and `cursor-agent` are Node programs (`ps -o comm=` would say
  `node`). So the PID walk never guesses. `--pid` (or `LAIKA_AGENT_HARNESS_PID`)
  names the process, and the watcher renews the session only while that PID
  lives with the same start time, exactly as for Claude Code.
- **The credential** is the agent's own token in `~/.laika/agents/<harness>.json`
  (0600) or `LAIKA_AGENT_TOKEN`. It is never written into a harness's config.
- **Delivery.** Nothing arrives mid-turn in any harness, Claude Code included:
  the earliest is the next boundary at which something runs. With no hooks,
  that boundary is the next time the agent or person runs `laika agent inbox`,
  or the MCP tool `agent_sync`.
- **Cross-tool hooks.** Cursor (Third-Party Imports, on by default) and Copilot
  CLI (the repo's `.claude/settings.json`) both **run Claude Code's hooks**, so
  a `laika agent hooks on --harness claude-code` install is also invoked
  inside them, named `claude-code`. **What that does there is Unverified.** By
  the code, the entry walks up for a process named `claude` and opens nothing
  when there is none, but no Cursor or Copilot run has shown it. Turn
  Third-Party Imports off in Cursor if you use both. This is also why Laika
  never writes Claude Code's file on Cursor's or Copilot's behalf.

## Session, credential and start

| Capability | Claude Code 2.1.280 | Codex 0.162.1 | Cursor 2026.01.28 | Copilot CLI | Copilot in VS Code | Copilot cloud agent | Gemini CLI 0.49.0 | Antigravity 2.0.6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Agent credential for the helper | Verified-and-tested (`laika agent login`) | Documented-not-tested | Documented-not-tested: `laika agent login cursor`, own file; the shared code is tested, no Cursor run | Documented-not-tested (same, `copilot-cli`) | Documented-not-tested (same, `copilot-vscode`) | Unsupported as a file: the sandbox's `HOME` is `/root`, ephemeral, with no `~/.laika`. `LAIKA_AGENT_TOKEN` in the hook environment is Unverified: the docs list only `GITHUB_COPILOT_API_TOKEN`, `GITHUB_COPILOT_GIT_TOKEN` and `COPILOT_AGENT_PROMPT` | Documented-not-tested (same, `gemini-cli`) | Documented-not-tested (same, `antigravity`) |
| Board MCP credential in the harness's own config | Verified-and-tested (`headers`) | Documented-not-tested (`bearer_token_env_var`) | Documented-not-tested: `mcp.json` `headers`, with `${env:NAME}` interpolation | Documented-not-tested: `~/.copilot/mcp-config.json` | Unverified: VS Code's own docs were not read for this | Documented-not-tested: `$COPILOT_MCP_*` Agents secrets substituted into the MCP config; hooks reach only GitHub and Copilot hosts unless an admin allowlists the board | Documented-not-tested: `settings.json` `mcpServers.<name>.headers`; `$VAR` expansion is documented for `env` only, so in `headers` it is Unverified | Documented-not-tested: `~/.gemini/config/mcp_config.json` `headers`; no env-var expansion documented, so a token there is a secret in a file, and Laika never writes one |
| Harness session id | `session_id` (hook input) | `session_id` | Documented-not-tested: `conversation_id` (every hook), `session_id` at `sessionStart` | Documented-not-tested: `sessionId` (camelCase hooks) / `session_id` (PascalCase) | Unverified: VS Code's hook payloads are in preview and differ by agent | Documented-not-tested: as Copilot CLI | Documented-not-tested: `session_id`; `GEMINI_SESSION_ID` in the hook env | Documented-not-tested: `conversationId`; `conversation_id` in `agy -p --output-format json` |
| Explicit `session start` with `--pid` | Verified-and-tested | Documented-not-tested | Documented-not-tested: the engine is tested with this slug and a fake board (`agent-adapters.test.ts`), not inside Cursor | Documented-not-tested (same) | Documented-not-tested (same) | Unsupported in practice: the board is behind the cloud firewall by default | Documented-not-tested (same) | Documented-not-tested (same) |
| PID walk finds the harness by name | Verified-and-tested (`claude`) | Documented-not-tested (`codex*`) | Unsupported here: no process name verified; `--pid` required | Unsupported here (same) | Unsupported here (same) | Unsupported (same) | Unsupported here: a Node program (`node`) | Unsupported here (same) |
| Renewal stops when the harness dies | Verified-and-tested | Documented-not-tested | Documented-not-tested: the shared watcher is tested, not with a Cursor PID | Documented-not-tested (same) | Documented-not-tested (same) | Unverified | Documented-not-tested (same) | Documented-not-tested (same) |
| Headless start | Verified-and-tested (`claude -p`) | Unverified (`codex exec`, hook trust) | Documented-not-tested: `agent -p` (`cursor-agent` here); run here, refused at sign-in | Documented-not-tested: `copilot -p PROMPT` | Unsupported: an editor, no headless mode | Documented-not-tested: `gh agent-task create` (gh manual) | Documented-not-tested: `gemini -p`; run here, stopped at sign-in | Documented-not-tested: `agy -p` (headless mode doc); `agy` is not installed |

## Hooks: lifecycle, checkpoint boundaries, inbox, injection

"Inject" means hook output that reaches the model.

| Capability | Claude Code 2.1.280 | Codex 0.162.1 | Cursor 2026.01.28 | Copilot CLI | Copilot in VS Code | Copilot cloud agent | Gemini CLI 0.49.0 | Antigravity 2.0.6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `laika agent hooks on` installs | Verified-and-tested | Documented-not-tested | Unsupported by Laika until a real run: prints the explicit commands, writes nothing | Unsupported by Laika (same) | Unsupported by Laika (same) | Unsupported by Laika (same) | Unsupported by Laika (same) | Unsupported by Laika (same) |
| Hook config, as documented | `~/.claude/settings.json` | `~/.codex/hooks.json` | Documented-not-tested: `~/.cursor/hooks.json`, `{ "version": 1, "hooks": { "sessionStart": [{ "command" }] } }`; `timeout` in seconds | Documented-not-tested: `~/.copilot/hooks/*.json`, `{ "version": 1, … "bash": … }`; `timeoutSec` | Unverified: preview; "do not assume the same events … work unchanged across surfaces" | Documented-not-tested: only `.github/hooks/*.json` in the repo | Documented-not-tested: `~/.gemini/settings.json` `hooks`; `timeout` in **milliseconds** | Documented-not-tested: `~/.gemini/config/hooks.json`, named groups; `timeout` in seconds |
| Session start / end hooks | Verified-and-tested | Documented-not-tested (end advisory) | Documented-not-tested: `sessionStart` (fire-and-forget) / `sessionEnd` (fire-and-forget); neither runs in cloud agents | Documented-not-tested: `sessionStart` / `sessionEnd` | Unverified | Documented-not-tested: a subset fires in the cloud | Documented-not-tested: `SessionStart` / `SessionEnd`, and the CLI "will not wait" for `SessionEnd` | Documented-not-tested: `SessionStart`; **no session-end hook** (`Stop` ends a loop, not the session), so a session ends by `laika agent session end` or by the lease expiring |
| Checkpoint boundaries (before and after a tool; end of turn) | Documented-not-tested (LAI-547 matrix) | Documented-not-tested | Documented-not-tested: `preToolUse` (deny with `permission: "deny"`), `postToolUse`, `stop` (`status`, no background-task list) | Documented-not-tested: `preToolUse` (`permissionDecision`), `postToolUse`, `agentStop` | Unverified | Documented-not-tested: `preToolUse`; `"ask"` is treated as `"deny"` | Documented-not-tested: `BeforeTool` (deny with `decision: "deny"`), `AfterTool`, `AfterAgent`; no `tool_use_id` | Documented-not-tested: `PreToolUse` (`decision: "deny"`), `PostToolUse` (with `error`), `Stop` (`fullyIdle` says whether background tasks still run) |
| Automatic checkpoints | Documented-not-tested in a real harness (consent tested) | Documented-not-tested | Unsupported by Laika: no hooks installed, so only `laika agent checkpoint save` | Unsupported by Laika (same) | Unsupported by Laika (same) | Unsupported by Laika (same) | Unsupported by Laika (same) | Unsupported by Laika (same) |
| Inbox check boundary | at a prompt and after a tool (hooks) | same | Explicit: `laika agent inbox` or MCP `agent_sync` when the agent runs it. Hooks would allow after a tool only | Explicit (same). Hooks would allow after a tool only | Explicit (same) | Explicit (same) | Explicit (same). Hooks would allow at a prompt and after a tool | Explicit (same). Hooks would allow before each model call |
| Inject at session start | Verified-and-tested (`additionalContext`) | Documented-not-tested | Documented-not-tested: `additional_context` (snake_case) | Documented-not-tested: `additionalContext` | Unverified | Documented-not-tested | Documented-not-tested: `hookSpecificOutput.additionalContext`; prepended to the prompt in `-p` | Documented-not-tested: `injectSteps` |
| Inject at a prompt | Documented-not-tested | Documented-not-tested | **Unsupported**: `beforeSubmitPrompt` returns only `continue` / `user_message` | **Unsupported**: "`userPromptSubmitted` hooks have their output dropped" | Unverified | Unsupported (same) | Documented-not-tested: `BeforeAgent` → `additionalContext`, this turn only | Documented-not-tested: `PreInvocation` → `injectSteps`, before every model call |
| Inject after a tool (the next tool boundary) | Documented-not-tested | Documented-not-tested (a block **replaces** the result) | Documented-not-tested: `postToolUse` → `additional_context` | Documented-not-tested: `postToolUse` → `additionalContext`, capped at 10 KB | Unverified | Documented-not-tested | Documented-not-tested: `AfterTool` → `additionalContext`, appended to the result | **Unsupported**: `PostToolUse` "returns an empty JSON object `{}`" |
| Context reload after a revision | the 300-character notice, then `get_project_context` | same | Explicit: `get_project_context` when the agent calls it | Explicit (same) | Explicit (same) | Explicit (same) | Explicit (same) | Explicit (same) |
| Mid-turn delivery | Unsupported (no harness interrupts a running turn) | Unsupported | Unsupported | Unsupported | Unsupported | Unsupported | Unsupported | Unsupported |

## What a later task needs, to move a harness to hooks

1. **A signed-in binary on Belka or Strelka.** Then a probe hook that records
   stdin, the hook's process ancestry, and its environment *names*, run by the
   real harness for every event in the table.
2. **An output writer per harness.** The engine today prints only Claude Code's
   and Codex's `hookSpecificOutput`. Cursor wants `additional_context` and
   `permission`, Gemini CLI wants `decision` / `reason`, and Antigravity wants
   `injectSteps` and `decision`.
3. **A process name** (`comm`) seen on the real process, or the decision that
   it stays `--pid` only.
4. **Each cell moved one at a time**, with the version it ran on. Then
   `hooks: true` in the adapter, and this file's test reads the change.
