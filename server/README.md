# server/ — owned by **CORE**

The single Node process that *is* Laika: Hono HTTP API, Drizzle/SQLite persistence,
better-auth sessions, the `/mcp` endpoint, SSE stream, in-process cron, and the
React + Vite SPA that is built into `server/public/` and served statically.

Nobody except CORE edits anything under this directory, **except `server/web/`,
which is SHELL's** (D-016): the split is API versus UI, not directory depth, so
SHELL never touches `server/src/` and CORE never touches `server/web/`.

If you are CHIEF or SHELL and you need something changed here, write a task file
in `.tasks/backlog/` with `area: server`.

Expected layout once LAI-001..LAI-004 land:

```
server/
  src/
    index.ts          # Hono app + server bootstrap
    db/               # Drizzle schema, migrations, client
    routes/           # /api/v1/* route modules
    policy/           # can(actor, action, resource)
    mcp/              # MCP tool handlers
    auth/             # better-auth wiring
  web/                # React + Vite SPA source
  public/             # built SPA output (gitignored)
```

See `docs/SPEC.md` for the contract this code has to satisfy.
