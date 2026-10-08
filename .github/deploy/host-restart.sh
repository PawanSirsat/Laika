#!/usr/bin/env bash
#
# Runs ON the production instance, as root, sent over SSM by deploy.sh (LAI-714).
#
#   host-restart.sh <registry>/laika@sha256:<digest>
#
# Pulls the image first and only then replaces the container, so the gap
# without a server is the container's own start time, not the download.
# Exits non-zero if the new container is not healthy within 90 seconds —
# deploy.sh reads that as a failed deploy and rolls back.
set -euo pipefail

IMAGE="$1"
REGISTRY="${IMAGE%%/*}"

aws ecr get-login-password --region us-east-1 |
  docker login --username AWS --password-stdin "$REGISTRY" >/dev/null

echo "before: $(docker inspect --format '{{.Config.Image}}' laika 2>/dev/null || echo none)"
docker pull --quiet "$IMAGE" >/dev/null

docker rm -f laika >/dev/null 2>&1 || true
docker run -d --name laika --restart unless-stopped \
  -p 80:3000 -v /data:/data --env-file /opt/laika/.env "$IMAGE" >/dev/null

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
  docker logs --tail 40 laika 2>&1 || true
  exit 1
fi

# Healthy, so every other image goes (LAI-720): `prune -a` removes each image no
# container uses, and the only container is the one just started. A failed
# start exits above and removes nothing; a rollback pulls from ECR anyway.
echo "images removed: $(docker image prune -af 2>/dev/null | grep -c '^deleted: ' || true)"
echo "images kept: $(docker images -q | sort -u | wc -l | tr -d ' ')"
