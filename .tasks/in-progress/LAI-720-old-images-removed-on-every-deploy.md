---
id: LAI-720
title: 'Old images are removed on every successful deploy — keep only the live one'
area: ops
assignee: chief
priority: p1
depends-on: [LAI-714]
status: in-progress
started: 2026-10-08T10:50:00Z
---

## Goal

The owner, 2026-10-08, after the AWS check found 53 images (4.7 GB) in ECR
and 1.8 GB of old images on the instance: *"I don't want the old images —
add it to the pipeline so old images auto-remove, but not the last successful
one."*

## Scope — the exact files

- `.github/workflows/deploy.yml` — a cleanup step after a successful deploy
- `.github/deploy/host-restart.sh` — prune every image but the running one, after health
- `infra/github-deploy-role.yml` — `ecr:ListImages`, `ecr:BatchDeleteImage` on `laika`
- `docs/HANDOVER.md` — §3 says so

## Acceptance criteria

- [ ] After a successful deploy, ECR `laika` holds only the live image (the
      digest `latest` points at); the instance holds only the running image.
- [ ] Nothing is removed when a deploy fails: the image a rollback needs —
      the last successful one — is always still in ECR.
- [ ] The deploy role may list and delete images in `laika` only, granted
      through the CloudFormation template.
- [ ] Today's backlog is cleaned once by hand: ECR down to the live image,
      the instance down to the running image.
- [ ] A real push proves it: the run deletes the previous image and production
      stays healthy.
