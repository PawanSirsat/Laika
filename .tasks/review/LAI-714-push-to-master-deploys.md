---
id: LAI-714
title: 'A push to master deploys itself — GitHub Actions to the current server'
area: ops
assignee: chief
priority: p1
depends-on: []
status: review
started: 2026-10-08T07:53:29Z
finished: 2026-10-08T08:14:44Z
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
- `cli/test/plugin-hooks.test.ts` — added mid-task: the second CI run failed
  *"a URL without a token sends nothing"* with an unhandled `write EPIPE` —
  the hook exits before the test's stdin write lands. Test-only.

## Acceptance criteria

- [x] Every push runs the gate (`pnpm test`, `pnpm lint`, `pnpm format`) in
      GitHub Actions; a red gate deploys nothing.
- [x] A green push to `master` builds the arm64 image on a GitHub arm64 runner,
      pushes it to ECR tagged with the commit, points `latest` at it, restarts
      the instance on that exact digest over SSM, and checks health from
      inside and outside.
- [x] A failed post-deploy check rolls production back to the previous image
      and fails the run.
- [x] Deploys queue: one at a time, and only the newest waiting commit runs.
- [x] No long-lived AWS keys: GitHub assumes a role through OIDC, trusted only
      for `master` of `PawanSirsat/Laika`, allowed only ECR push to `laika`,
      SSM on the one instance, and describing instances. The role is created
      from the CloudFormation template.
- [ ] A real push to master deploys end to end, verified on the live site.
- [x] D-073 records the rule, and CLAUDE.md §4 tells every session that a
      push to `origin/master` is a release.

## Delivery notes

- **AWS.** Stack `laika-github-deploy` (CREATE_COMPLETE) from
  `infra/github-deploy-role.yml`: the GitHub OIDC provider, which the account
  had none of, and role `arn:aws:iam::926583575159:role/laika-github-deploy`,
  trusted only for `repo:PawanSirsat/Laika:ref:refs/heads/master`.
- **Workflow.** `.github/workflows/deploy.yml`: the gate on every push; on master,
  build on `ubuntu-24.04-arm` to ECR as `sha-<commit>`, retag `latest`, then
  `.github/deploy/deploy.sh`, which sends `host-restart.sh` over SSM. The
  restart pulls first, runs the exact digest, and waits up to 90s for health.
  The runner checks it runs that image, is freshly healthy from outside and
  serves the app. A failure points `latest` back at the image it replaced and
  restarts on it.
- **CI exposed two timing races, both test-only, both in the scope list.**
  - list-view's paging test counted rows the instant the pager drew.
  - plugin-hooks raised an unhandled `EPIPE` when the hook exited before its
    stdin write landed.
  CI run 37747800026 is green on GitHub: server 2099, web 1333, cli 85.
- **The last criterion is open on purpose**: it is the first push to master.
  It is ticked in the accept note once that deploy is verified.
