#!/usr/bin/env bash
#
# Runs on the GitHub runner (LAI-714): restart production on one exact image
# and prove it from both sides.
#
#   deploy.sh <registry>/laika@sha256:<digest>
#
# Needs AWS credentials for the laika-github-deploy role, AWS_REGION and
# INSTANCE_ID in the environment.
set -euo pipefail

IMAGE="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"

# The host script travels inside the command, so the instance needs nothing
# but the SSM agent. AWS-RunShellScript runs the lines as one script and
# reports the exit code of the last line, so the restart's own code is
# carried to the end explicitly — otherwise the clean-up would report success
# for a failed restart.
script_b64="$(base64 -w0 "$HERE/host-restart.sh")"
params="$(jq -n --arg b "$script_b64" --arg img "$IMAGE" '{commands: [
  "echo \($b) | base64 -d > /tmp/laika-restart.sh",
  "bash /tmp/laika-restart.sh \($img); rc=$?",
  "rm -f /tmp/laika-restart.sh",
  "exit $rc"
]}')"

command_id="$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "Laika deploy ${GITHUB_SHA:0:7}" \
  --timeout-seconds 600 \
  --parameters "$params" \
  --query Command.CommandId --output text)"
echo "SSM command $command_id"

status=Pending
for _ in $(seq 1 100); do
  status="$(aws ssm get-command-invocation --command-id "$command_id" \
    --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)"
  case "$status" in Success | Failed | Cancelled | TimedOut) break ;; esac
  sleep 3
done

output="$(aws ssm get-command-invocation --command-id "$command_id" \
  --instance-id "$INSTANCE_ID" --query StandardOutputContent --output text)"
echo "$output"
aws ssm get-command-invocation --command-id "$command_id" \
  --instance-id "$INSTANCE_ID" --query StandardErrorContent --output text | grep -v 'WARNING! Your password\|credential helper\|credentials-store\|^$' || true

if [ "$status" != Success ]; then
  echo "::error::the restart did not succeed on the instance ($status)"
  exit 1
fi
if ! grep -qxF "running: $IMAGE" <<<"$output"; then
  echo "::error::the instance is not running $IMAGE"
  exit 1
fi

# From outside, as a reader would reach it. A health check that answers is
# not enough on its own: uptime_ms must be fresh, or the answer came from a
# container that was never replaced.
ip="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)"
health="$(curl -fsS -m 10 "http://$ip/api/v1/health")"
echo "outside: $health"
uptime="$(jq -r '.uptime_ms' <<<"$health")"
if [ "$(jq -r '.status' <<<"$health")" != ok ] || [ "$uptime" -gt 300000 ]; then
  echo "::error::production is not freshly healthy from outside (uptime_ms $uptime)"
  exit 1
fi

# The page itself, and the script it loads.
asset="$(curl -fsS -m 10 "http://$ip/" | grep -o 'assets/[^"]*\.js' | sed -n 1p)"
if [ -z "$asset" ] || ! curl -fsS -m 20 -o /dev/null "http://$ip/$asset"; then
  echo "::error::the web app did not load from outside"
  exit 1
fi
echo "deployed: $IMAGE (serving $asset)"
