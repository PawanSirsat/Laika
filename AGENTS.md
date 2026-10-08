# AGENTS.md — start here

You are working on **Laika**, a self-hosted project board where people and
coding agents share one source of truth. This file is the entry point for any
agent, in any harness and on any model. It is short on purpose. It tells you
what to read and which rules are not optional.

## Read these, in this order

1. **`docs/HANDOVER.md`** covers where everything runs, how a change reaches
   production, how development works, who holds which credential, and what is
   open. Read it in full before your first change.
2. **`CLAUDE.md`** is the binding working agreement. The name is historical:
   it applies to every agent, whatever model reads it. Where this file and
   `CLAUDE.md` disagree, `CLAUDE.md` wins.
3. **`docs/SPEC.md`** says what Laika is supposed to do. **`docs/DECISIONS.md`**
   says why it is the way it is. Decisions are append-only.
4. The task file you are about to work on, in `.tasks/`, top to bottom.

`.claude/skills/*/SKILL.md` and `.claude/commands/*.md` are plain markdown
instructions written for Claude Code. Any harness can read them as procedures.

## Rules that are not optional

- **A push to `origin/master` is a production release** (D-073). GitHub Actions
  runs the full gate, builds the image and deploys it within about fifteen
  minutes. Never push to master without running the gate locally first.
- **The gate is three commands, each with its own exit code**: `pnpm test`,
  `pnpm lint`, `pnpm format`. Never pipe a gate command into anything. The
  exit code is the claim, not a pass count.
- **The repository is public.** Never commit a secret, token, password or
  `.env` file. `.env*` is gitignored; keep it that way.
- **No task file, no work.** Every change is a task in `.tasks/` with
  acceptance criteria. The protocol is in `CLAUDE.md` §2.
- **Commit as the owner's personal GitHub identity**:
  `Pawan Sirsat <48860105+PawanSirsat@users.noreply.github.com>`. Use message
  format `type(area): summary [LAI-xxx]`.
- **Verify, don't recall.** Check an identifier, a count or a path against the
  live system or the file before you write it down. Most of `CLAUDE.md` is the
  record of what happened when someone didn't.

## The ten-second version

| | |
| --- | --- |
| Production | one EC2 instance behind an Elastic IP, AWS `us-east-1`, account `926583575159`. The address is the `laika` stack's `Url` output, not written in this public repo (LAI-627) |
| Deploys | push to `master` triggers `.github/workflows/deploy.yml` |
| Stack | TypeScript, Node 22, pnpm 10; Hono API, Better Auth, MCP SDK, SQLite via better-sqlite3 + Drizzle; React 19 + Vite |
| Owner | Pawan Sirsat, GitHub `PawanSirsat` |
