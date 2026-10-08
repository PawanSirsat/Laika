---
id: LAI-714
title: 'A push to master deploys itself — GitHub Actions to the current server'
area: ops
assignee: chief
priority: p1
depends-on: []
status: in-progress
started: 2026-10-08T07:53:29Z
---

## Goal

The owner, 2026-10-08: *"if I push on master, that must deploy automatically —
that's it."* After weighing Dokploy (the current t4g.micro has 1 GB of memory,
a 15 GB disk and Amazon Linux, below Dokploy's floor), the owner chose GitHub
Actions deploying to the server Laika already runs on.

## Scope — the exact files this task may create (CLAUDE.md §1)

- `.github/workflows/deploy.yml`
- `.github/deploy/deploy.sh` — runs on the GitHub runner
- `.github/deploy/host-restart.sh` — runs on the instance, over SSM
- `infra/github-deploy-role.yml` — CloudFormation for the OIDC provider and role
- `docs/DECISIONS.md` (D-073), `CLAUDE.md` §4 — the rule that a push deploys
- `server/web/test/browser/list-view.test.ts` — added mid-task: the first CI
  run exposed a race in *"pages the table rather than drawing every row at
  once"* (rows counted the instant the pager drew; CI saw 0). Test-only.

## Acceptance criteria

- [ ] Every push runs the gate (`pnpm test`, `pnpm lint`, `pnpm format`) in
      GitHub Actions; a red gate deploys nothing.
- [ ] A green push to `master` builds the arm64 image on a GitHub arm64 runner,
      pushes it to ECR tagged with the commit, points `latest` at it, restarts
      the instance on that exact digest over SSM, and checks health from
      inside and outside.
- [ ] A failed post-deploy check rolls production back to the previous image
      and fails the run.
- [ ] Deploys queue: one at a time, and only the newest waiting commit runs.
- [ ] No long-lived AWS keys: GitHub assumes a role through OIDC, trusted only
      for `master` of `PawanSirsat/Laika`, allowed only ECR push to `laika`,
      SSM on the one instance, and describing instances. The role is created
      from the CloudFormation template.
- [ ] A real push to master deploys end to end, verified on the live site.
- [ ] D-073 records the rule, and CLAUDE.md §4 tells every session that a
      push to `origin/master` is a release.
