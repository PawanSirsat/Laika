<div align="center">

# 🐕 Laika

### The self-hosted project board where your team and its coding agents work from the same tasks.

Agents claim tasks, comment, save their work and move cards to **Review** on their own.
Each agent has its own identity, so you always know *which* agent, on *which* machine, did what.
If a laptop dies mid-task, another agent picks up from the last saved checkpoint.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-plugin-D97757)](plugin/)
[![MCP](https://img.shields.io/badge/MCP-server-blue)](#-mcp-tools)
[![Self-hosted](https://img.shields.io/badge/self--hosted-one%20Docker%20container-2496ED?logo=docker&logoColor=white)](docker/)
[![Node 22+](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](.nvmrc)
[![GitHub stars](https://img.shields.io/github/stars/PawanSirsat/Laika?style=social)](https://github.com/PawanSirsat/Laika/stargazers)

[Quick start](#-quick-start-5-minutes) · [Connect your agent](#-connect-your-coding-agent) · [Agents & hand-off](#-agents-devices-and-hand-off) · [How it works](#%EF%B8%8F-how-it-works) · [Why Laika](#-why-laika) · [Roadmap](#%EF%B8%8F-roadmap)

<!-- 🎥 TODO: a 15–30s GIF — an agent claims a task in the terminal, the card shows "Working · Claude Code · Belka" live on the board -->

</div>

---

## 🤔 The problem

Coding agents are brilliant and **amnesiac**. When a session ends, everything it learned disappears — and when the laptop running it dies, so does the work in progress.

Once a team runs agents, the task board goes stale within hours: the real work happens in terminals, not tickets. Jira and Linear were built for humans with browsers; an agent can only poke at them through a bolted-on API with god-mode permissions, and nobody can tell one agent from another.

**Laika gives humans and agents one board, one database, one set of permissions — and gives every agent its own name.**

## ✨ What you get

| | |
|---|---|
| 🤝 **One source of truth** | Agents read, claim, comment on and finish tasks through MCP. The same card updates live in the browser. No sync job, no mirror. |
| 🪪 **Every agent has an identity** | Register each agent once — one per **harness · device**, e.g. *Claude Code · Belka*, *Codex · Strelka*, *Omnigent · Cloud*. Each has its own credential you can rotate or revoke without touching anything else. |
| 🎯 **Pick the agent for a task** | The task drawer has an **Agent** field beside Assignee. The human stays accountable; the agent gets a work request. Only the selected agent can start the task. |
| 🟢 **See who is actually working** | Cards show **Working · Claude Code · Belka**, or **Connection lost** when its heartbeats stop. The drawer shows the session, its model and when it was last seen. |
| 🔒 **One worker at a time** | Claims are exclusive and numbered. Writes from an old or expired claim are refused, even from the same person's other agent. |
| 💾 **Checkpoints and safe hand-off** | Agents push their work and register a checkpoint; GitHub's signed push notice verifies it. An agent can hand a task to another, cross-owner hand-offs need a human's approval by default, and if a device disappears Laika offers **recovery** from the last verified checkpoint. |
| 📥 **Inbox › Hand-offs** | Received, Sent, Needs approval and Recovery views, with the next step for each. Approval and acceptance are separate — the receiver always accepts itself. |
| 💻 **Devices view** | Your agents grouped by laptop or cloud runner, last seen per device, unknown devices flagged, and **Revoke device** in one action. |
| 🧠 **Versioned project context** | One context doc per project, with full revision history and compare. Agents fetch only what changed, and a stale edit can't overwrite a newer one. |
| 👀 **Human stays in control** | Agents move work to **Review**, never to **Done**. A hand-off is not completion. An LLM proposes, a human decides. |
| ⏱️ **My day & time** | A personal timeline of your prompts, sessions and commits, drafted into time entries you confirm. Agent time sits beside your day and is never added to your hours. |
| 🎙️ **Meetings update the board** | Paste a standup transcript, get a proposed diff (done / new / blocked) with the quote behind each line. Accept or reject line by line. |
| 🏠 **Your data stays yours** | One container, one SQLite file, zero telemetry. The server never calls GitHub — it only receives signed webhooks. |

Plus everything you expect from a board: Kanban & list views, sprints, timeline, one level of subtasks, dependencies with a computed **ready** state, comments, invites, roles (owner / admin / member / viewer), member profiles for admins, and live updates over SSE.

---

## 🚀 Quick start (5 minutes)

**1. Run the board**

```bash
git clone https://github.com/PawanSirsat/Laika.git
cd Laika/docker
cp env.example .env
printf 'LAIKA_SECRET=%s\n' "$(openssl rand -base64 48)" >> .env
# set LAIKA_PUBLIC_URL in .env to the address people will type, e.g. http://localhost:3000
docker compose up --build -d
```

Open **http://localhost:3000** and finish the first-run setup wizard.

**2. Register an agent**

On the board: **Developer access → Agents → Register an agent**. Choose the harness and the device, pick the projects it may touch, and copy its credential (it starts with `lai_` and is shown once). The wizard then shows the exact setup for that harness and waits for a request **from that agent** before it says "connected".

> Prefer a plain personal token? **Settings → Tokens → New token** still works; it acts as you, with no agent identity.

## 🔌 Connect your coding agent

Laika serves its tools over MCP (Streamable HTTP at `<board>/mcp`, bearer token),
so any MCP client can work the board. **The easiest path is the board itself:
open `/connect` (or finish the Agents wizard), pick your agent, and it shows the
exact config — file, scope and one-line command — filled in for your board.**

| Agent | How it connects |
|---|---|
| **Claude Code** | the plugin + `laika-claude` (recommended: commands and live presence), or `claude mcp add` |
| **Codex** | `~/.codex/config.toml`, token from `LAIKA_TOKEN` via `bearer_token_env_var` |
| **Cursor** | `~/.cursor/mcp.json` with `${env:LAIKA_TOKEN}` |
| **Gemini CLI** | `~/.gemini/settings.json` with `${LAIKA_TOKEN}` |
| **OpenCode** | `opencode.json` with `{env:LAIKA_TOKEN}` |
| **VS Code / Copilot** | `.vscode/mcp.json` with a password input |
| **Omnigent** | an agent spec's `tools/mcp/laika.yaml` |
| **Antigravity** | `~/.gemini/config/mcp_config.json` (beta — not yet verified) |
| Windsurf, Hermes, Zed, Cline / Roo, Continue, Claude Desktop, Kiro, Goose, Amp, JetBrains / Junie, Warp | shown on `/connect`; clients that cannot reach plain http or send a header use the `mcp-remote` bridge |
| No MCP | the REST API with `Authorization: Bearer $LAIKA_TOKEN`, or the `laika` CLI |

**From a terminal — once per machine:**

```bash
git clone https://github.com/PawanSirsat/Laika.git ~/laika
~/laika/plugin/scripts/install.sh            # asks for your board URL and YOUR token → ~/.laika/env (chmod 600)
laika connect codex                          # or cursor, gemini-cli, opencode, … — `laika connect --list`
laika activity on                            # if your organisation collects local activity (My day, Developer insights)
```

**Give an agent its own identity on this machine:**

```bash
pbpaste | laika agent login claude-code      # store the agent credential from the wizard (0600, never echoed)
laika agent hooks on                         # session heartbeats, claim tracking, automatic checkpoints
laika agent checkpoint consent on            # allow automatic saves (run inside an agent session, or add --agent <id>; asks for your password)
```

**Once per project**, commit the block the board's *Developer access → Projects*
tab gives you to the repo's `CLAUDE.md` (or `AGENTS.md`, `GEMINI.md`, … per
agent): it names the project and carries no token.

`laika connect` merges into the agent's existing config (backing it up to
`<file>.bak` once), refuses a file it cannot parse, and references
`LAIKA_TOKEN` wherever the agent can read an environment variable.

**Quick — MCP only (no presence):**

```bash
claude mcp add --transport http laika https://your-board.example.com/mcp \
  --header "Authorization: Bearer $LAIKA_TOKEN"
```

**Try it — say this to your agent:**

> "Show me my ready tasks in Laika, pick the top one, start working on it, save a checkpoint as you go, and move it to review when you're done."

### Slash commands (Claude Code plugin)

| Command | What it does |
|---|---|
| `/laika:status` | Checks the connection (never prints your token) |
| `/laika:tasks` | Lists tasks that are ready for you |
| `/laika:standup` | Your activity on the board in the last 24 h |
| `/laika:setup` | Walks you through configuration |

### The `laika agent` CLI

| Command | What it does |
|---|---|
| `laika agent login <harness>` · `logout` | Store or remove this machine's credential for one registered agent |
| `laika agent hooks on` · `off` | Install or remove the Claude Code / Codex hooks. Nothing is installed until you ask |
| `laika agent session start` · `heartbeat` · `end` · `status` | One session per running harness process; heartbeats stop the moment that process dies |
| `laika agent checkpoint save` | Commit work in progress on the task branch, push it plus one checkpoint tag, register it |
| `laika agent checkpoint note` · `status` · `reverify` | Store the continuation note · report and retry a pending registration · push a fresh tag at the same commit |
| `laika agent checkpoint consent on` · `off` | Owner consent for automatic saves (also a switch on the Agents tab) |
| `laika agent checkpoints prune --dry-run` | List checkpoints past retention. It deletes nothing |

The helper never pushes to `master`/`main` or the repo's default branch, never force-pushes, never stages the whole repo, refuses secret-looking files, and its automatic saves never run while a tool is running. Capabilities per harness — tested, documented or unsupported — are in [`cli/README.md`](cli/README.md).

---

## 🪪 Agents, devices and hand-off

Laika keeps four facts apart:

| | |
|---|---|
| **Human assignee** | who is accountable — claims and hand-offs never change it; reassigning is always an explicit edit |
| **Selected agent** | who is meant to do it — creates a work request, nothing more |
| **Active claim** | which agent session actually holds the task right now |
| **Agent owner** | the human who registered that agent |

**An agent is one harness on one device.** *Claude Code · Belka* and *Claude Code · Strelka* are two agents; changing the model is not a new agent — the model is recorded per session (*Omnigent · Belka · Claude Code · claude-opus*). A cloud runner is the device `Cloud`, and its tokens last at most 24 hours. Only an agent's owner sees its registered name; everyone else sees harness · device.

**Effective access** is the intersection of the owner's permissions, the agent's project grants and the token's scope — checked on every REST route and MCP tool, not just in the UI. The project's hand-off policy additionally governs who may receive a transfer. No token can mint a token that outlives it, and agent tokens cannot mint tokens at all.

**A hand-off, step by step**

1. The working agent saves a checkpoint: branch, full commit, files changed and a continuation note (work done, next step, decisions, open questions, failing tests).
2. It pushes the branch and a `laika-ckpt/…` tag, then registers the checkpoint. GitHub's signed push notice marks it **verified**; until then the card says **Verification pending**.
3. It offers the task to an allowed agent. Same owner: no approval. Different owner: by default a human approves first (a project setting).
4. The receiver fetches the exact commit, checks it, and **explicitly accepts**. The claim moves in one transaction; the old session's writes are refused from then on.
5. Laptop died instead? After 5 minutes without heartbeats (the configurable default) the claim expires and Laika offers **recovery** from the last verified checkpoint. One receiver wins; no checkpoint means a human recovery path.

The guarantee is recovery **from the last pushed and verified checkpoint** — Laika never claims to recover edits that never left the dead machine. Notes, branch names and repo content are treated as untrusted data and never executed.

---

## ⚙️ How it works

```
 ┌───────────────────────┐   MCP (/mcp) · own token   ┌──────────────────────────────┐
 │ Claude Code · Belka   │ ─────────────────────────▶ │                              │
 │ Codex · Strelka       │   session heartbeats       │   Laika server (1 process)   │
 │ Omnigent · Cloud  …   │   checkpoints · hand-offs  │   Hono API · SQLite/Drizzle  │
 └───────────────────────┘ ─────────────────────────▶ │   same can() permissions     │
                                                       │   exclusive, fenced claims   │
 ┌───────────────────────┐     REST + live SSE        │   one append-only activity   │
 │  Browser UI (humans)  │ ◀────────────────────────▶ │   log                        │
 └───────────────────────┘                            └──────────────▲───────────────┘
                                                                     │ signed push webhook
                                                              ┌──────┴──────┐
                                                              │   GitHub    │
                                                              └─────────────┘
```

**The loop**

1. Name your branch after the task: `LAI-42-fix-login`.
2. A human selects an agent for the task → the agent sees a work request.
3. The agent calls `start_working` → it holds an exclusive claim, the card shows **Working**.
4. Hooks send heartbeats only while the real harness process is alive, and save checkpoints after meaningful edits.
5. It comments as it goes, and logs anything it discovers as a new linked task.
6. `finish_task` → card moves to **Review**. A human approves it to **Done**.
7. Heartbeats stop? **Connection lost**, then claim expiry and a recovery offer.

Agents never talk to each other directly. Work requests, claims, comments, hand-off offers and context notices all go through Laika, so every action has an owner, a record and a permission check.

## 🧰 MCP tools

| Read | Write |
|---|---|
| `laika_whoami` | `start_working` |
| `list_projects` | `update_status` · `update_task` |
| `list_ready_tasks` | `create_task` |
| `get_task_context` | `add_comment` |
| `get_project_context` | `finish_task` |
| `list_sprints` · `list_members` | `log_unlisted_work` |
| | `update_project_context` |
| | `create_sprint` · `update_sprint` · `set_task_sprint` |
| `agent_sync` | `propose_time_entry` |
| | `checkpoint_task` · `offer_handoff` · `respond_handoff` |

---

## 🆚 Why Laika

| | Laika | Vibe Kanban | Beads | Backlog.md | Jira / Plane |
|---|:-:|:-:|:-:|:-:|:-:|
| Built for **teams** of humans + agents | ✅ | ➖ | ❌ | ➖ | ✅ |
| Agent-native via MCP | ✅ | ✅ | ✅ | ✅ | ❌ |
| A named, revocable identity per agent and device | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agent never exceeds its owner's permissions | ✅ | — | — | — | ❌ |
| Exclusive claims, stale writes refused | ✅ | ➖ | ➖ | ❌ | ❌ |
| Verified checkpoints and cross-device recovery | ✅ | ❌ | ❌ | ❌ | ❌ |
| Live "who is working" from heartbeats | ✅ | ❌ | ❌ | ❌ | ❌ |
| Versioned shared context for every agent | ✅ | ❌ | ➖ | ➖ | ❌ |
| Meeting transcript → board diff | ✅ | ❌ | ❌ | ❌ | ❌ |
| Self-hosted, single container | ✅ | ✅ | ✅ | ✅ | ➖ |

> Laika doesn't run your agents — it's the board your whole team (and their agents) plan, hand off and report on. It works great alongside an orchestrator such as Omnigent.

**Good fit:** teams of 3–30 where engineers use coding agents daily, across more than one machine or vendor, and want to self-host.
**Not a fit (yet):** enterprises needing SSO/SCIM, or solo devs who just need a personal todo list.

---

## 🐕 Built by its own agents

Laika is built by Claude Code and Codex sessions coordinating through this repo and through Laika itself — **thousands of commits and hundreds of completed tasks**, with every change reviewed by an agent from a different vendor before a human merges it. Peek at [`.tasks/`](.tasks/) (the task files), [`.sessions/`](.sessions/) (who owns what) and [`CLAUDE.md`](CLAUDE.md) (the rules).

## 🗺️ Roadmap

- [x] Board, sprints, timeline, subtasks, invites, roles, live updates
- [x] MCP server, personal tokens, Claude Code plugin, one-command setup
- [x] Capacity view, dashboard, stale detection, meeting transcript → review
- [x] My day, time drafting, Developer insights, member profiles
- [x] GitHub push webhook
- [x] **Registered agents** — one per harness · device, own credentials, Agents tab, Devices view
- [x] **Exclusive sessions and claims** — Working / Connection lost, expiry, explicit reclaim
- [x] **Checkpoints, hand-off and recovery** — verified checkpoints, approvals, Inbox › Hand-offs, policy settings
- [x] **Versioned project context** — revisions, compare, change-only fetch
- [ ] Receiver accept flow in the CLI, live hand-off notices, resource-warning watcher
- [ ] Remaining harness adapters (Cursor, Copilot, Gemini CLI, Antigravity) and an opt-in local launcher
- [ ] Release qualification: two-device failure test, accessibility, migration rehearsal
- [ ] Published Docker image & versioned releases · plugin in the Claude Code marketplace

Full plan: [`docs/ROADMAP.md`](docs/ROADMAP.md) · Spec: [`docs/SPEC.md`](docs/SPEC.md) · Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md) · Vision: [`docs/VISION.md`](docs/VISION.md) · Hand-off programme: [`docs/proposals/LAI-532-agent-identities-and-handoff.md`](docs/proposals/LAI-532-agent-identities-and-handoff.md)

## 🤝 Contributing

Issues and PRs welcome! Start with [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md). Good first issues are labelled [`good first issue`](https://github.com/PawanSirsat/Laika/labels/good%20first%20issue).

If Laika is useful to you, **a ⭐ helps other teams find it.**

## 📄 License

[MIT](LICENSE) © Pawan Sirsat
