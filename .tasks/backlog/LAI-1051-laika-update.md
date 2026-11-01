---
id: LAI-1051
title: 'Developer access V3 slice E2: laika update moves the CLI checkout to the board''s own commit, staged, verified and rolled back on failure'
area: cli
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-1042
status: backlog
---

Plan: `docs/proposals/LAI-1042-developer-access-v3-plan.md` sections F.5, H,
L3 and K. Builds on LAI-1043 (`GET /api/v1/developer/compatibility`,
`laika version`, `laika doctor`), already on `master`. Dispatched by the owner
through Polly as one slice.

## Goal

`laika update` moves this machine's Laika checkout to the commit the connected
board was built from (`cli.source.commit` of the compatibility answer, from
`cli.source.url`, which honours a board's `LAIKA_CLI_SOURCE_URL` fork), never
"newest master". It refuses rather than risks local work, stages and checks the
target before switching, and puts everything back when anything fails. It never
touches a credential, a device key, consent, grants or a repository's
instruction files.

## Acceptance criteria

- [ ] `laika update` with a board that has no compatibility answer (404, or a
      200 that is not the body) prints `Version unknown — cannot pick a safe
      target`, exits non-zero and changes nothing; a board that does not
      answer prints `Could not check` and changes nothing.
- [ ] A dirty checkout (any `git status --porcelain` output) is refused, and
      so is a checkout whose `HEAD` has commits the source does not have
      (diverged); neither is ever stashed, reset or discarded.
- [ ] The target is fetched from the board's `cli.source.url` by commit and
      must resolve to exactly the advertised 40-character SHA; anything else
      (short SHA, a SHA the source does not have, a branch name) is refused.
- [ ] Before anything changes, the previous `HEAD` and every config file the
      refresh may touch are copied under `~/.laika/update/<ts>/`.
- [ ] The target is checked out in a separate staging worktree, `laika
      version --json` and `laika doctor --offline --json` run there, and a
      failure there leaves the checkout's `HEAD` and files unchanged.
- [ ] The switch is `checkout --detach <commit>`; an interrupted switch (a
      leftover in-flight marker) is recovered on the next run by returning to
      the recorded previous commit.
- [ ] Hooks are re-applied only where they were already on, and the laika MCP
      entry only where it already exists; other MCP servers and unrelated
      config keys are byte-identical afterwards.
- [ ] Any failure after the switch rolls back to the previous commit, restores
      the backed-up files, and prints exactly what was restored.
- [ ] `--dry-run` prints the plan and writes nothing; `--check` prints one of
      Up to date / Update available / Update required for <feature> / Version
      unknown / Could not check and writes nothing.
- [ ] Already at the target: `Up to date`, exit 0, nothing written.
- [ ] Restart and trust instructions are printed where they apply (restart
      Claude Code with `laika-claude`; trust the hook in Codex with `/hooks`).
- [ ] Tests in temp git repos cover: clean update, dirty refused, diverged
      refused, wrong SHA refused, network failure, staging self-check failure
      rolled back, interrupted switch recovered, config backup with other MCP
      servers untouched, no secret in any output, and `~/.laika/env`,
      `~/.laika/agents/*` and `~/.laika/device/*` byte-identical before and
      after.
- [ ] `cli/README.md` documents the command.

## Notes / context

- No npm: the package is private and the checkout is the distribution
  (`cli/bin/laika`). No new dependency.
- Signed release tags are a follow-up hardening (plan L3), not this task.
- Does not touch device pairing (LAI-1050) or the V3 web shell (LAI-1048).
