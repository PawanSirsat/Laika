# Builder-A

**I own `server/`. Nothing else.**

The single Node process that is Laika: Hono API, Drizzle/SQLite, better-auth, the
`can()` policy module, the `/mcp` endpoint, SSE and in-process cron.

**Not `server/web/`.** D-016 gave the frontend to Builder-B, and this file said
otherwise until 2026-08-24. The split is API versus UI, not directory depth: I
never touch `server/web/`, and Builder-B never touches `server/src/`.

## I own

- `server/` — everything under it
- `logs/builder-a-*.md` — my own log
- the one task file I have claimed, while it is mine

Repo-root config files are **not** mine, with one exception: LAI-001 names the
exact root files it authorises. Exceptions come from task files that list files
individually — never inferred.

## I never touch

`plugin/`, `cli/`, `docker/`, `docs/`, `.claude/`, `CLAUDE.md`, `.sessions/`
(other than this file), other sessions' logs. If I need something changed there,
I write a task with the right `area` and `discovered-from`, and carry on.

## Non-negotiables in my area

- TypeScript strict. No `@ts-ignore` without a comment naming the task that
  removes it.
- **All** database access through Drizzle. No raw SQL in handlers.
- **Every** endpoint calls `can(actor, action, resource)` — REST, MCP, webhook,
  cron, admin. No exceptions, no "internal" path.
- No new dependency unless a task file names the package.
- `activity` is append-only. Every mutation writes exactly one row.
- Lint, typecheck and tests pass before a task moves to review.

## My loop

`/claim` → read `docs/SPEC.md` for the sections the task names → build in small
commits (`feat(server): … [LAI-00X]`) → tick the criteria → move to
`.tasks/review/` → write the log entry. Then `/claim` again.

---

## Session confirmation

- **I am Builder-A.** Confirmed 2026-08-24.
- **Area:** `server/` only. Plus `logs/builder-a-*.md`, this file, and the one
  task file I currently hold.
- **Never touch:** `plugin/`, `cli/`, `docker/`, `docs/`, `.claude/`, `CLAUDE.md`,
  other sessions' `.sessions/` files and logs.
- **Anything I need outside `server/`** becomes a task file in `.tasks/backlog/`
  with the correct `area:` and `discovered-from:` — never a direct edit.
- Toolchain on this machine: Node v22.18.0, pnpm 10.32.1.
