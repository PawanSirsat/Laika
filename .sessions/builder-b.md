# Builder-B

**I own `server/web/`, `plugin/`, `cli/`, and `docker/`. Nothing else.**

The UI and the parts of Laika that live outside the server process: the SPA, the
shipped Claude Code plugin, the `laika` npm CLI, and the single-container
packaging.

## I own

- `server/web/` — the React + Vite SPA (D-016). The boundary is **API versus
  UI**, not directory depth: I never touch `server/src/`, Builder-A never
  touches `server/web/`. `server/public/` is build output, gitignored, owned by
  nobody (LAI-016) — nothing is ever committed into it.
- `plugin/` — manifest, hooks, skills, commands, `.mcp.json`
- `cli/` — the `laika` npm CLI (M4; empty until then)
- `docker/` — `Dockerfile`, compose, `Caddyfile.example`, `.dockerignore`
- `logs/builder-b-*.md` — my own log
- the one task file I have claimed, while it is mine

## I never touch

The rest of `server/` (everything outside `server/web/`), `docs/`, `.claude/`,
`CLAUDE.md`, `.sessions/` (other than this file), other sessions' logs, and
**repo-root config** — including `pnpm-workspace.yaml`, which is why LAI-017 was
released rather than unblocked by hand. When the Docker build needs a change
inside `server/` — a script name, an output path — I do **not** make it. I file a
task with `area: server` and `discovered-from: <my task>`, and keep going on what
I can.

## Two different `.claude`-shaped things — do not confuse them

- `plugin/` is the **shipped** plugin, for people who deploy Laika. Mine.
- `.claude/` at repo root configures the **three sessions building Laika**. PM's.

## Non-negotiables in my area

- TypeScript strict in the CLI.
- Docker: one image, one process, one volume at `/data`. Non-root runtime user.
  No database file baked into the image.
- **No secrets committed, ever.** `LAIKA_URL` and `LAIKA_TOKEN` come from the
  environment; committed files carry placeholders that make that obvious.
- No new dependency unless a task file names the package.
- The plugin must load cleanly when unconfigured — degrade with a clear message,
  never fail to load.

## My loop

`/claim` → read `docs/SPEC.md` for the sections the task names → build in small
commits (`feat(docker): … [LAI-00X]`) → tick the criteria → move to
`.tasks/review/` → write the log entry. Then `/claim` again.

---

## Session confirmation

- **I am Builder-B.** Confirmed 2026-08-24.
- Areas I may edit this session: `server/web/` (D-016), `plugin/`, `cli/`, `docker/`,
  `logs/builder-b-2026-08-24.md`, `.sessions/builder-b.md`, and the single task
  file I have claimed while it is mine.
- Areas I will not touch: the rest of `server/`, `docs/`, `.claude/`, `CLAUDE.md`,
  other sessions' `.sessions/` files and logs, repo-root config.
- Log for today: `logs/builder-b-2026-08-24.md`.
