<div align="center">

# 🐕 Laika

### The self-hosted project board where your team and your Claude Code agents work from the same tasks.

Your agents claim tasks, comment, and move cards to **Review** on their own.
Your board stops going stale. Your team stops re-explaining the project to their Claude.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-plugin-D97757)](plugin/)
[![MCP](https://img.shields.io/badge/MCP-20%20tools-blue)](#-mcp-tools)
[![Self-hosted](https://img.shields.io/badge/self--hosted-one%20Docker%20container-2496ED?logo=docker&logoColor=white)](docker/)
[![Node 22+](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](.nvmrc)
[![GitHub stars](https://img.shields.io/github/stars/PawanSirsat/Laika?style=social)](https://github.com/PawanSirsat/Laika/stargazers)

[Quick start](#-quick-start-5-minutes) · [Connect Claude Code](#-connect-claude-code) · [How it works](#-how-it-works) · [Why Laika](#-why-laika) · [Roadmap](#-roadmap)

<!-- 🎥 REPLACE WITH A 15–30s GIF: Claude Code claims a task in the terminal, the card moves live on the board -->
![Laika demo](docs/assets/demo.gif)

</div>

---

## 🤔 The problem

Claude Code is brilliant and **amnesiac**. When a session ends, everything it learned disappears.

And once your team runs coding agents, the task board goes stale within hours — the real work is happening in terminals, not in tickets. Jira and Linear were built for humans with browsers; an agent can only poke at them through a bolted-on API with god-mode permissions.

**Laika fixes that by giving humans and agents one board, one database, and one set of permissions.**

## ✨ What you get

| | |
|---|---|
| 🤝 **One source of truth** | Agents read, claim, comment on and finish tasks through MCP. The same card updates live in the browser. No sync job, no mirror. |
| 🟢 **Live presence & capacity** | A tiny heartbeat (repo + branch only) shows who is working on what — **without anyone updating a ticket**. |
| 🧠 **Shared project context** | One context doc per project, injected into every teammate's agent. Decide something once; every Claude knows it. |
| 🎙️ **Meetings update the board** | Paste a standup transcript, get a proposed diff (done / new / blocked) with the quote behind each line. Accept or reject line by line. |
| 🔐 **Agents are users, not service accounts** | Each agent acts with *its human's* token and permissions. Every action lands in the same audit log, badged as agent-made. |
| 👀 **Human stays in control** | Agents can move work to **Review**, never to **Done**. An LLM proposes, a human decides. |
| 🏠 **Your data stays yours** | One container, one SQLite file, zero telemetry. |

Plus everything you expect from a board: Kanban & list views, sprints, timeline, dependencies with a computed **ready** state, comments, invites, roles (owner / admin / member / viewer), and live updates over SSE.

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

**2. Create a token**

On the board: **Settings → Tokens → New token**. Copy it (it starts with `lai_` and is shown once).

## 🔌 Connect Claude Code

**Recommended — plugin + live presence (one command):**

```bash
~/path/to/Laika/plugin/scripts/install.sh
# asks for your board URL and YOUR token, saves them to ~/.laika/env (chmod 600)
```

Then start Claude Code through Laika from any project folder:

```bash
laika-claude
```

**Quick — MCP only (no presence):**

```bash
claude mcp add --transport http laika https://your-board.example.com/mcp \
  --header "Authorization: Bearer lai_xxxxxxxx"
```

**Try it — say this to Claude:**

> "Show me my ready tasks in Laika, pick the top one, start working on it, and move it to review when you're done."

### Slash commands

| Command | What it does |
|---|---|
| `/laika:status` | Checks the connection (never prints your token) |
| `/laika:tasks` | Lists tasks that are ready for you |
| `/laika:standup` | Your activity on the board in the last 24 h |
| `/laika:setup` | Walks you through configuration |

---

## ⚙️ How it works

```
 ┌──────────────┐      MCP (/mcp)       ┌─────────────────────────────┐
 │ Claude Code  │ ───────────────────▶  │                             │
 │  + plugin    │   heartbeat (branch)  │   Laika server (1 process)  │
 └──────────────┘ ───────────────────▶  │   Hono API · SQLite/Drizzle │
                                         │   same can() permissions    │
 ┌──────────────┐   REST + live SSE     │   one activity log          │
 │  Browser UI  │ ◀──────────────────▶  │                             │
 │  (humans)    │                        └─────────────────────────────┘
 └──────────────┘
```

**The auto-update loop**

1. Name your branch after the task: `lai-42-fix-login`.
2. The plugin's hooks send a heartbeat on session start, tool use and stop → the board shows the task as actively worked on.
3. The agent calls `start_working` → card moves to **In progress**.
4. It comments as it goes, and logs anything it discovers as a new linked task.
5. `finish_task` → card moves to **Review**. A human approves it to **Done**.
6. No heartbeat for 3 days? The task is flagged **stale**.

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

---

## 🆚 Why Laika

| | Laika | Vibe Kanban | Beads | Backlog.md | Jira / Plane |
|---|:-:|:-:|:-:|:-:|:-:|
| Built for **teams** of humans + agents | ✅ | ➖ | ❌ | ➖ | ✅ |
| Agent-native via MCP | ✅ | ✅ | ✅ | ✅ | ❌ |
| Agent uses *your* permissions (no service account) | ✅ | — | — | — | ❌ |
| Live presence from heartbeats | ✅ | ❌ | ❌ | ❌ | ❌ |
| Shared context for every teammate's agent | ✅ | ❌ | ➖ | ➖ | ❌ |
| Meeting transcript → board diff | ✅ | ❌ | ❌ | ❌ | ❌ |
| Self-hosted, single container | ✅ | ✅ | ✅ | ✅ | ➖ |

> Laika doesn't run your agents — it's the board your whole team (and their agents) plan and report on. It works great alongside an orchestrator.

**Good fit:** teams of 3–30 where most engineers use Claude Code daily and want to self-host.
**Not a fit (yet):** enterprises needing SSO/SCIM, or solo devs who just need a personal todo list.

---

## 🐕 Built by its own agents

Laika was built by a small team of Claude Code sessions coordinating through files in this repo — **~2,000 commits and 300+ completed tasks**. Peek at [`.tasks/`](.tasks/) (the board), [`.sessions/`](.sessions/) (who owns what) and [`CLAUDE.md`](CLAUDE.md) (the rules) to see the workflow Laika itself is designed to replace.

## 🗺️ Roadmap

- [x] Board, sprints, timeline, invites, roles, live updates
- [x] MCP server + personal access tokens
- [x] Claude Code plugin, heartbeat hooks, one-command setup
- [x] Capacity view & dashboard, stale detection
- [x] Meeting transcript → review screen
- [ ] Published Docker image & versioned releases
- [ ] Plugin in the Claude Code marketplace
- [ ] `npx laika init`
- [ ] GitHub webhook (push / PR → board)

Full plan: [`docs/ROADMAP.md`](docs/ROADMAP.md) · Spec: [`docs/SPEC.md`](docs/SPEC.md) · Vision: [`docs/VISION.md`](docs/VISION.md)

## 🤝 Contributing

Issues and PRs welcome! Start with [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md). Good first issues are labelled [`good first issue`](https://github.com/PawanSirsat/Laika/labels/good%20first%20issue).

If Laika is useful to you, **a ⭐ helps other teams find it.**

## 📄 License

[MIT](LICENSE) © Pawan Sirsat
