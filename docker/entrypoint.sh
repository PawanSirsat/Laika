#!/bin/sh
#
# Laika container entrypoint.
#
# One job: refuse to start without a server secret, then exec the real process.
# `exec` matters — it makes node PID 1's direct child under tini, so SIGTERM
# reaches it and LAI-002's graceful shutdown runs.

set -eu

# SPEC §11.7 calls this SERVER_SECRET. LAI-008's acceptance criteria call it
# LAIKA_SECRET. Nothing in the server reads either one yet (server/src/env.ts
# says so explicitly), so both names are accepted here and normalised to the
# spec's name — that way the compose file matches the task, and LAI-005 finds
# what SPEC §11.7 told it to look for. Reconciling the two names is LAI-024.
if [ -z "${SERVER_SECRET:-}" ] && [ -n "${LAIKA_SECRET:-}" ]; then
  SERVER_SECRET="$LAIKA_SECRET"
  export SERVER_SECRET
fi
if [ -z "${LAIKA_SECRET:-}" ] && [ -n "${SERVER_SECRET:-}" ]; then
  LAIKA_SECRET="$SERVER_SECRET"
  export LAIKA_SECRET
fi

if [ -z "${LAIKA_SECRET:-}" ]; then
  cat >&2 <<'MSG'
laika: refusing to start — no server secret is set.

LAIKA_SECRET (SPEC §11.7 calls it SERVER_SECRET) is the key material that
encrypts the org's stored API keys and SMTP credentials. Starting without it
would mean generating a throwaway secret on every boot, which silently makes
yesterday's encrypted values unreadable.

Generate one and keep it with your volume — losing it loses those secrets:

    openssl rand -base64 48

Then set it, e.g. in docker/.env next to docker-compose.yml:

    LAIKA_SECRET=<the value>

docker/README.md has the full list of environment variables.
MSG
  exit 1
fi

# A too-short secret is worse than an obviously absent one: it looks configured.
if [ "${#LAIKA_SECRET}" -lt 32 ]; then
  echo "laika: refusing to start — LAIKA_SECRET is ${#LAIKA_SECRET} characters, minimum 32." >&2
  echo "laika: generate one with: openssl rand -base64 48" >&2
  exit 1
fi

# The volume is the whole backup story (D-002); if it is not writable, fail here
# with a sentence rather than inside SQLite with an errno.
DATA_DIR="${DATA_DIR:-/data}"
if [ ! -w "$DATA_DIR" ]; then
  echo "laika: refusing to start — $DATA_DIR is not writable by $(id -un) (uid $(id -u))." >&2
  echo "laika: the named volume should be owned by uid 1000; a host bind mount needs chown." >&2
  exit 1
fi

exec "$@"
