# server/ — owned by **Builder-A**

The single Node process that *is* Laika: Hono HTTP API, Drizzle/SQLite persistence,
better-auth sessions, the `/mcp` endpoint, SSE stream, in-process cron, and the
React + Vite SPA that is built into `server/public/` and served statically.

Nobody except Builder-A edits anything under this directory. If you are PM or
Builder-B and you need something changed here, write a task file in
`.tasks/backlog/` with `area: server`.

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
