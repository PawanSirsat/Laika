# Laika

A self-hosted project board where humans and Claude Code agents work from one
source of truth. Single Node process — Hono API, SQLite via Drizzle, React + Vite
SPA, and an MCP endpoint that lets an agent read and write the same board a human
does, under the same permissions.

**Status: bootstrapping.** No application code yet — see `docs/ROADMAP.md`.

## Where things are

| Path | What | Owner |
| --- | --- | --- |
| `server/` | Hono API, Drizzle/SQLite, MCP endpoint, React SPA | Builder-A |
| `plugin/` | The shipped Claude Code plugin | Builder-B |
| `cli/` | The `laika` npm CLI | Builder-B |
| `docker/` | Dockerfile, compose, Caddyfile example | Builder-B |
| `docs/` | `SPEC.md`, `ROADMAP.md`, `DECISIONS.md` | PM |
| `.tasks/` | The board — one file per task, directory = status | PM moves to done |
| `logs/` | One log file per session per day | each session, its own |
| `.sessions/` | Identity files: who owns what | PM |

## If you are a session working on this repo

Read `CLAUDE.md` first, then `docs/SPEC.md`, then your own file in `.sessions/`.
Work only from task files. `/claim` to take one, `/standup` to see the board.
