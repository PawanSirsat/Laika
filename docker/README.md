# docker/ — owned by **Builder-B**

Packaging for the single-container deployment: `Dockerfile` (multi-stage — build
the SPA, build the server, run one Node process), `docker-compose.yml`, and a
`Caddyfile.example` for TLS termination in front of the container.

Contract: one image, one process, one data volume mounted at `/data` holding the
SQLite database (WAL mode) and any uploads. See `docs/DECISIONS.md` D-002.

If you need a change here, write a task file in `.tasks/backlog/` with
`area: docker`.
