# docker/ — owned by **Builder-B**

Packaging for the single-container deployment: one image, one Node process, one
writable volume at `/data` (D-002). Back up that volume and you have backed up
Laika.

```
docker/
  Dockerfile                  multi-stage: deps → web → server → prod-deps → runtime
  Dockerfile.dockerignore     build-context ignore list (see "Why not .dockerignore")
  docker-compose.yml          the service, the volume, the port
  entrypoint.sh               refuses to start without a server secret
  env.example                 copy to .env
  Caddyfile.example           TLS termination in front of the container
```

## Quick start

```bash
cd docker
cp env.example .env
printf 'LAIKA_SECRET=%s\n' "$(openssl rand -base64 48)" >> .env   # replace the placeholder
# and set LAIKA_PUBLIC_URL to the address people will actually type
docker compose up --build -d
curl http://127.0.0.1:3000/api/v1/health
```

`{"status":"ok","version":"0.1.0","uptime_ms":…}` means it worked. Opening
<http://127.0.0.1:3000/> serves the placeholder document — the SPA is not built
yet (LAI-017), and the server falls back to a committed page whenever
`public/index.html` is absent (LAI-016).

## Building without compose

The build context is the **repo root**, because the image needs `server/`:

```bash
docker build -f docker/Dockerfile -t laika:local .
```

Running it directly, note that `/data` must be a volume — the image deliberately
contains no database:

```bash
docker run --rm -p 3000:3000 -v laika-data:/data \
  -e LAIKA_SECRET="$(openssl rand -base64 48)" \
  -e LAIKA_PUBLIC_URL="http://localhost:3000" \
  laika:local
```

## Environment

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `LAIKA_SECRET` | **yes** | — | Key material for encrypting stored API keys and SMTP settings. Minimum 32 characters. The container refuses to start without it. |
| `LAIKA_PUBLIC_URL` | **yes** | — | The URL your users type, scheme included, no trailing slash. Invite links and webhook URLs are built from it. Behind a TLS proxy this is the **proxy's** address, not the container's. |
| `LAIKA_DB_PATH` | no | `/data/laika.db` | Must stay inside the data volume, or the database lands somewhere backups do not reach. |
| `LAIKA_DATA_DIR` | no | `/data` | Where the database and backups live. `LAIKA_DB_PATH` wins if both are set. |
| `PORT` | no | `3000` | Container-internal. Map it with compose's `LAIKA_PORT`. |
| `LAIKA_PORT` | no | `3000` | Host port compose publishes. Compose-only, not read by the server. |
| `NODE_ENV` | no | `production` | |

Every variable the server reads is `LAIKA_`-prefixed (D-018), except the two
conventional ones — `PORT` and `NODE_ENV`.

**`LAIKA_PUBLIC_URL` has no default on purpose.** A default that works on a
laptop is the failure this variable exists to prevent: it would send invite
links to `localhost` from a real deployment, and that surfaces days later as a
mail problem rather than immediately as a configuration one.

Everything lives in `docker/.env`, which is gitignored. **No secret is ever
committed** — `env.example` carries an obvious placeholder.

Losing `LAIKA_SECRET` makes previously encrypted settings unreadable. Keep it
wherever you keep the volume backup.

Both required variables are checked twice — once by compose's `${VAR:?…}`
interpolation, which fails before a container is created, and again by
`entrypoint.sh` for anyone running the image directly with `docker run`.

## Backup and restore

The volume is the whole story.

```bash
# Back up: stop first so SQLite's WAL is checkpointed into the database file.
docker compose stop
docker run --rm -v docker_laika-data:/data -v "$PWD:/backup" alpine \
  tar czf /backup/laika-backup.tar.gz -C /data .
docker compose start

# Restore into an empty volume.
docker run --rm -v docker_laika-data:/data -v "$PWD:/backup" alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/laika-backup.tar.gz -C /data'
```

Copying `/data` while the server runs can capture the database mid-write; the
`.db-wal` file comes along, so it is usually recoverable, but stopping first is
the version that always works.

`docker compose down` keeps the volume. **`docker compose down -v` deletes it**,
and that is the only supported way to lose your data by accident.

## TLS

`Caddyfile.example` terminates TLS and proxies to the container. The one setting
that matters is that the proxy must **not buffer responses** — `/api/v1/events`
is SSE (D-003), a response that never ends, and a buffering proxy silently stops
the board updating rather than producing an error. Caddy does not buffer by
default; the example sets `flush_interval -1` so that stays true if someone adds
a global directive later.

## What the image does and does not contain

- Compiled JavaScript, production dependencies, the built SPA, the generated
  migrations, and the fallback document. No TypeScript, no `tsx`, no `vitest`,
  no compiler.
- **No database.** `/data` is a declared `VOLUME`; the image ships empty.
- Runs as the `node` user (uid 1000), never root. `no-new-privileges` is set in
  compose.
- `tini` is PID 1 so `SIGTERM` reaches Node and the graceful shutdown from
  LAI-002 actually runs. Compose does **not** set `init: true` — that would put
  a second init at PID 1 and demote tini.
- `HEALTHCHECK` calls `GET /api/v1/health` using Node's own `fetch`, so there is
  no `curl` in the image.

## Why `Dockerfile.dockerignore` and not `.dockerignore`

Docker reads the ignore list from the **context root**, and the context is the
repo root — so a working `.dockerignore` would have to be a new repo-root file,
which is not Builder-B's to add (CLAUDE.md §1). BuildKit checks
`<dockerfile>.dockerignore` first, so `docker/Dockerfile.dockerignore` does the
same job and stays inside this directory. It requires BuildKit, which is the
default in Docker 23+.

Likewise `env.example` is not named `.env.example`: the repo-root `.gitignore`
ignores `.env*`, so the dot-prefixed name would be untracked and invisible.

## Known gaps

Both gaps recorded here are closed. The image now builds the real SPA
(`pnpm --filter @laika/web build`, LAI-017) and builds the server with the
package's own script (`pnpm --filter @laika/server build`, LAI-024) rather than
open-coding `tsc` and copying assets by hand.

Each build stage asserts its own output — `index.html` for the SPA,
`dist/index.js`, `dist/static/fallback.html` and the migrations journal for the
server. An earlier version swallowed a failed SPA build with `|| true` and
shipped an empty `public/`, which surfaced as a 500 on `GET /` rather than as a
failed build.

If you need a change here, write a task file in `.tasks/backlog/` with
`area: docker`.
