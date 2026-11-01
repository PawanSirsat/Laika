#!/usr/bin/env bash
#
# Runs ON the production instance, as root, sent over SSM by deploy.sh (LAI-714).
#
#   host-restart.sh <registry>/laika@sha256:<digest> deploy   <run>   a deploy
#   host-restart.sh <registry>/laika@sha256:<digest> rollback <run>   CI's rollback
#
# <run> names the workflow run (deploy.sh passes run id and attempt); the
# rollback restores only a snapshot taken during a deploy with the same <run>.
#
# Pulls the image first and only then replaces the container, so the gap
# without a server is the container's own start time, not the download.
# Exits non-zero if the new container is not healthy within 90 seconds —
# deploy.sh reads that as a failed deploy and rolls back.
#
# A rollback also puts the database back when the failed deploy migrated it
# (LAI-1033). Boot copies the database to /data/backups/pre-migration-*.sqlite
# before it applies a migration (LAI-468), so a snapshot written since this
# deploy began means the database is now ahead of the image being restored,
# and older code on a newer schema ignores agent grants and claims
# (docs/AGENTS-ROLLOUT.md § 7). The rollback stops the container, moves the
# migrated database aside — kept, never deleted — copies the snapshot over it
# and starts the previous image on that. No snapshot since the deploy began
# means nothing was migrated, and the rollback is the image alone, as before.
set -euo pipefail

IMAGE="$1"
MODE="${2:-deploy}"
RUN="${3:-}"
REGISTRY="${IMAGE%%/*}"

# The host's volume. Overridable only so server/test/tooling/host-restart.test.ts
# can run this against a temporary directory; production sets neither.
DATA="${LAIKA_HOST_DATA:-/data}"
DB="$DATA/laika.db"
BACKUPS="$DATA/backups"
# Written by a deploy just before it starts the new container: its <run> on
# the first line, and its mtime on this instance's clock, which is the clock
# the container writes its snapshots by.
DEPLOY_STARTED="${LAIKA_DEPLOY_STARTED:-/opt/laika/deploy-started-at}"
# The first words of the refusal in server/src/db/migrate.ts.
SCHEMA_AHEAD_MARKER='laika: schema-ahead'

case "$MODE" in deploy | rollback) ;; *)
  echo "unknown mode: $MODE"
  exit 2
  ;;
esac

aws ecr get-login-password --region us-east-1 |
  docker login --username AWS --password-stdin "$REGISTRY" >/dev/null

echo "before: $(docker inspect --format '{{.Config.Image}}' laika 2>/dev/null || echo none)"
docker pull --quiet "$IMAGE" >/dev/null

docker rm -f laika >/dev/null 2>&1 || true

# The oldest snapshot since the deploy began is the one taken before its first
# boot. A boot that crashed half way through migrating and was restarted takes
# another, of the half-migrated file, so the newest is the wrong one.
#
# **Only if the marker is this run's.** A deploy that failed before it reached
# the instance left the previous successful deploy's marker, and the snapshot
# after that one is days of other people's work behind the live file.
this_deploys_snapshot() {
  [ -n "$RUN" ] && [ -f "$DEPLOY_STARTED" ] || return 0
  [ "$(sed -n 1p "$DEPLOY_STARTED")" = "$RUN" ] || return 0
  find "$BACKUPS" -maxdepth 1 -type f -name 'pre-migration-*.sqlite' -newer "$DEPLOY_STARTED" \
    2>/dev/null | sort | sed -n 1p
}

if [ "$MODE" = deploy ]; then
  mkdir -p "$(dirname "$DEPLOY_STARTED")"
  printf '%s\n%s\n' "$RUN" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$DEPLOY_STARTED"
else
  snapshot="$(this_deploys_snapshot)"
  if [ -n "$snapshot" ]; then
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    aside="$DB.rolled-back-$stamp"
    echo "restore: the failed deploy migrated the database; restoring $snapshot"
    echo "restore: snapshot sha256 $(sha256sum "$snapshot" | cut -d' ' -f1)"
    # The live database is three files in WAL mode, so all three move
    # together and stay a consistent set. Moved, never removed.
    for suffix in '' -wal -shm; do
      if [ -e "$DB$suffix" ]; then
        mv "$DB$suffix" "$aside$suffix"
        echo "restore: kept $DB$suffix as $aside$suffix"
      fi
    done
    # Copied, so the snapshot itself stays where it is. `-p` keeps the owner
    # the container wrote it as. One file: a snapshot has no -wal or -shm.
    cp -p "$snapshot" "$DB"
    echo "restore: $DB is now $snapshot"
  else
    echo "restore: none needed (no pre-migration snapshot since run ${RUN:-?} began)"
  fi
fi

docker run -d --name laika --restart unless-stopped \
  -p 80:3000 -v "$DATA:/data" --env-file /opt/laika/.env "$IMAGE" >/dev/null

healthy=no
for _ in $(seq 1 45); do
  if curl -fsS -m 2 http://localhost/api/v1/health >/tmp/laika-health.json 2>/dev/null; then
    healthy=yes
    break
  fi
  sleep 2
done

echo "running: $(docker inspect --format '{{.Config.Image}}' laika)"
echo "health: $(cat /tmp/laika-health.json 2>/dev/null || echo none)"

if [ "$healthy" != yes ]; then
  echo "unhealthy: the new container did not answer /api/v1/health in 90s"
  logs="$(docker logs --tail 40 laika 2>&1 || true)"
  echo "$logs"
  if grep -qF "$SCHEMA_AHEAD_MARKER" <<<"$logs"; then
    echo "schema-ahead: this image refuses the database because a newer build migrated it" \
      "and this deploy took no snapshot to restore. Restore by hand:" \
      "docs/AGENTS-ROLLOUT.md § 7, Full rollback."
  fi
  exit 1
fi

# Healthy, so every other image goes (LAI-720): `prune -a` removes each image no
# container uses, and the only container is the one just started. A failed
# start exits above and removes nothing; a rollback pulls from ECR anyway.
echo "images removed: $(docker image prune -af 2>/dev/null | grep -c '^deleted: ' || true)"
echo "images kept: $(docker images -q | sort -u | wc -l | tr -d ' ')"
