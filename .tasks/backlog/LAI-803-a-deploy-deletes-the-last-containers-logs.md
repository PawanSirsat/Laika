---
id: LAI-803
title: 'Each deploy deletes the previous container''s logs, and sar keeps no TCP history, so a slow night cannot be investigated afterwards'
area: docker
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-786
status: backlog
---

## Goal

After a bad night, the logs and network counters from that night still exist
the next morning.

## Found

From the same explore as LAI-802 (2026-10-20):

- `.github/deploy/host-restart.sh` runs `docker rm -f laika` with the default
  json-file log driver, so every deploy deletes the previous container's
  logs.
- `sar -n ETCP` answers "Requested activities not available", because
  `SADC_OPTIONS` lacks `-S XALL`. That history alone would have answered
  whether the midnight slowness was packet loss.

## Acceptance criteria

- [ ] Before the old container is removed, its logs are kept: saved to a
      file on the host with a bounded total size, or sent with the `awslogs`
      driver. If it is `awslogs`, the template grants the instance role
      exactly the actions needed and names them. Choose one and say why.
- [ ] `sar` records TCP and retransmit history (`SADC_OPTIONS="-S XALL"` or
      equivalent), set in the infrastructure template rather than by hand.
- [ ] A failed save never blocks or fails a deploy.
- [ ] The deploy runbook says where the old logs are and how to read them.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0. After the
      first deploy, a read-only check shows the previous container's logs
      kept.
