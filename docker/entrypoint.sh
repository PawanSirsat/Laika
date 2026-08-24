#!/bin/sh
#
# Laika container entrypoint.
#
# One job: refuse to start on a configuration that would fail later or, worse,
# succeed wrongly. Then exec the real process.
#
# `exec` matters — it makes node PID 1's direct child under tini, so SIGTERM
# reaches it and LAI-002's graceful shutdown runs.
#
# The server validates all of this too (server/src/env.ts). Checking here as
# well is deliberate: a container that dies in a restart loop shows an operator
# a stack of identical log lines, while these messages say what to set and how
# to generate it. Keep the two in step — the 32-character minimum below is the
# server's MIN_SECRET_LENGTH.

set -eu

# --- LAIKA_SECRET --------------------------------------------------------
# Key material for encrypting the org's stored API keys and SMTP settings.
if [ -z "${LAIKA_SECRET:-}" ]; then
  cat >&2 <<'MSG'
laika: refusing to start — LAIKA_SECRET is not set.

It encrypts the org's stored API keys and SMTP credentials. Starting without it
would mean a throwaway key on every boot, which silently makes yesterday's
encrypted values unreadable.

Generate one and keep it with your volume — losing it loses those secrets:

    openssl rand -base64 48

Then set it in docker/.env next to docker-compose.yml:

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

# --- LAIKA_PUBLIC_URL ----------------------------------------------------
# Invite links and webhook URLs are built from it. The server requires it in
# production; the message here explains the consequence rather than the rule.
if [ -z "${LAIKA_PUBLIC_URL:-}" ]; then
  cat >&2 <<'MSG'
laika: refusing to start — LAIKA_PUBLIC_URL is not set.

Invite links and webhook URLs are built from it, so a missing or wrong value is
not a startup problem — it is people receiving invitations that point somewhere
they cannot reach, and GitHub delivering webhooks to nowhere.

Set it to the URL your users type, including the scheme, with no trailing slash:

    LAIKA_PUBLIC_URL=https://laika.example.com

Behind a TLS proxy (docker/Caddyfile.example) this is the proxy's address, not
the container's.
MSG
  exit 1
fi

case "$LAIKA_PUBLIC_URL" in
  http://*|https://*) ;;
  *)
    echo "laika: refusing to start — LAIKA_PUBLIC_URL has no http(s) scheme: $LAIKA_PUBLIC_URL" >&2
    echo "laika: it is pasted into links, so it must be a URL people can click." >&2
    exit 1 ;;
esac

# --- /data ----------------------------------------------------------------
# The volume is the whole backup story (D-002); if it is not writable, fail here
# with a sentence rather than inside SQLite with an errno.
data_dir="${LAIKA_DATA_DIR:-/data}"
if [ ! -w "$data_dir" ]; then
  echo "laika: refusing to start — $data_dir is not writable by $(id -un) (uid $(id -u))." >&2
  echo "laika: the named volume should be owned by uid 1000; a host bind mount needs chown." >&2
  exit 1
fi

exec "$@"
