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
# (docs/AGENTS-ROLLOUT.md § 7). The rollback stops the container, puts the
# snapshot in place of the migrated database — which is kept beside it, never
# deleted — and starts the previous image on that. A restore that fails is
# undone, and the previous image starts on the database as it was. No snapshot since the deploy began
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

# **Never start on a fresh database while a real one sits beside it.** A
# missing `laika.db` makes the server create an empty one and come up healthy,
# so a deploy would go green on no data. Kept copies from a rollback mean the
# real one exists and someone has to put it back (LAI-1033 review, B1).
if [ ! -e "$DB" ] && compgen -G "$DB.rolled-back-*" >/dev/null; then
  echo "refused: $DB is missing but rolled-back copies exist:"
  ls -l "$DB".rolled-back-* || true
  echo "refused: put the right file back at $DB by hand before deploying" \
    "(docs/AGENTS-ROLLOUT.md § 7). Nothing was started or changed."
  exit 1
fi

# Before anything is stopped: a failure here exits with the old container
# still running.
if [ "$MODE" = deploy ]; then
  mkdir -p "$(dirname "$DEPLOY_STARTED")"
  printf '%s\n%s\n' "$RUN" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$DEPLOY_STARTED"
fi

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
#
# Prints nothing, and never fails, when there is nothing to restore — a
# missing backups directory included.
this_deploys_snapshot() {
  [ -n "$RUN" ] && [ -f "$DEPLOY_STARTED" ] && [ -d "$BACKUPS" ] || return 0
  [ "$(sed -n 1p "$DEPLOY_STARTED")" = "$RUN" ] || return 0
  { find "$BACKUPS" -maxdepth 1 -type f -name 'pre-migration-*.sqlite' -newer "$DEPLOY_STARTED" \
    2>/dev/null || true; } | sort | sed -n 1p
}

# Put the snapshot in place of the live database, keeping the live one.
#
# **`$DB` is never missing.** The snapshot is copied to a temporary name
# first; the original gets a second name by hard link; and the copy is renamed
# over `$DB` in one step. Every step checks its own result rather than relying
# on `set -e` — which a function called from `if` does not have — and records
# what it did only once it has succeeded, so the undo reverses this run's
# steps and nothing else (LAI-1037).
did_copy=no
did_link=no
moved=""
restore() {
  local snapshot="$1" suffix
  cp -p "$snapshot" "$DB.restoring" || return 1
  did_copy=yes
  if [ -e "$DB" ]; then
    ln "$DB" "$aside" || return 1
    did_link=yes
    echo "restore: kept $DB as $aside"
  fi
  # A -wal or -shm left beside the restored file would replay over it.
  for suffix in -wal -shm; do
    if [ -e "$DB$suffix" ]; then
      mv "$DB$suffix" "$aside$suffix" || return 1
      moved="$moved $suffix"
      echo "restore: kept $DB$suffix as $aside$suffix"
    fi
  done
  mv -f "$DB.restoring" "$DB" || return 1
}

# Back to exactly the files there were, reversing only what `restore` did.
undo_restore() {
  local suffix
  for suffix in $moved; do mv -f "$aside$suffix" "$DB$suffix" || true; done
  # The final rename is the last step, so on any failure the link this run
  # made is a second name for `$DB` itself: removing it removes no data.
  if [ "$did_link" = yes ]; then
    if [ "$aside" -ef "$DB" ]; then rm -f "$aside"; else mv -f "$aside" "$DB" || true; fi
  fi
  if [ "$did_copy" = yes ]; then rm -f "$DB.restoring"; fi
}

restore_failed=no
if [ "$MODE" = rollback ]; then
  snapshot="$(this_deploys_snapshot)"
  if [ -n "$snapshot" ]; then
    aside="$DB.rolled-back-$(date -u +%Y%m%dT%H%M%SZ)"
    echo "restore: the failed deploy migrated the database; restoring $snapshot"
    echo "restore: snapshot sha256 $({ sha256sum "$snapshot" || echo unreadable; } | cut -d' ' -f1)"
    # **Nothing this restore would write may exist already** — an earlier
    # rollback in the same second, or a copy a crash left behind. `mv` would
    # overwrite a kept -wal or -shm without a word.
    taken=""
    for name in "$aside" "$aside-wal" "$aside-shm" "$DB.restoring"; do
      if [ -e "$name" ]; then taken="$taken $name"; fi
    done
    if [ -n "$taken" ]; then
      restore_failed=yes
      echo "restore: FAILED — refused before touching anything: already exists:$taken." \
        "Starting the previous image on the database as it is. Restore $snapshot" \
        "by hand (docs/AGENTS-ROLLOUT.md § 7)."
    elif restore "$snapshot"; then
      echo "restore: $DB is now $snapshot"
    else
      undo_restore
      restore_failed=yes
      echo "restore: FAILED — the database is back as it was before this step;" \
        "starting the previous image on it. It may refuse it (schema-ahead):" \
        "restore $snapshot by hand (docs/AGENTS-ROLLOUT.md § 7)."
    fi
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
    if [ "$restore_failed" = yes ]; then
      echo "schema-ahead: this image refuses the database because a newer build migrated it," \
        "and the restore above failed, so the migrated database is still in place." \
        "Restore $snapshot by hand: docs/AGENTS-ROLLOUT.md § 7, Full rollback."
    else
      echo "schema-ahead: this image refuses the database because a newer build migrated it" \
        "and this run took no snapshot to restore. Restore by hand:" \
        "docs/AGENTS-ROLLOUT.md § 7, Full rollback."
    fi
  fi
  exit 1
fi

# The previous image is up, on the database it had, but the restore it needed
# did not happen: the step stays red so a person looks.
if [ "$restore_failed" = yes ]; then
  echo "restore: FAILED — running on the database as it was; see above"
  exit 1
fi

# Healthy, so every other image goes (LAI-720): `prune -a` removes each image no
# container uses, and the only container is the one just started. A failed
# start exits above and removes nothing; a rollback pulls from ECR anyway.
echo "images removed: $(docker image prune -af 2>/dev/null | grep -c '^deleted: ' || true)"
echo "images kept: $(docker images -q | sort -u | wc -l | tr -d ' ')"
