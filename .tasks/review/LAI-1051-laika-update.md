---
id: LAI-1051
title: 'Developer access V3 slice E2: laika update moves the CLI checkout to the board''s own commit, staged, verified and rolled back on failure'
area: cli
assignee: polly
priority: p2
depends-on: []
started: 2026-11-01T22:04:43Z
finished: 2026-11-01T22:18:37Z
discovered-from: LAI-1042
status: review
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

- [x] `laika update` with a board that has no compatibility answer (404, or a
      200 that is not the body) prints `Version unknown — cannot pick a safe
      target`, exits non-zero and changes nothing; a board that does not
      answer prints `Could not check` and changes nothing.
- [x] A dirty checkout (any `git status --porcelain` output) is refused, and
      so is a checkout whose `HEAD` has commits the source does not have
      (diverged); neither is ever stashed, reset or discarded.
- [x] The target is fetched from the board's `cli.source.url` by commit and
      must resolve to exactly the advertised 40-character SHA; anything else
      (short SHA, a SHA the source does not have, a branch name) is refused.
- [x] Before anything changes, the previous `HEAD` and every config file the
      refresh may touch are copied under `~/.laika/update/<ts>/`.
- [x] The target is checked out in a separate staging worktree, `laika
      version --json` and `laika doctor --offline --json` run there, and a
      failure there leaves the checkout's `HEAD` and files unchanged.
- [x] The switch is `checkout --detach <commit>`; an interrupted switch (a
      leftover in-flight marker) is recovered on the next run by returning to
      the recorded previous commit.
- [x] Hooks are re-applied only where they were already on, and the laika MCP
      entry only where it already exists; other MCP servers and unrelated
      config keys are byte-identical afterwards.
- [x] Any failure after the switch rolls back to the previous commit, restores
      the backed-up files, and prints exactly what was restored.
- [x] `--dry-run` prints the plan and writes nothing; `--check` prints one of
      Up to date / Update available / Update required for <feature> / Version
      unknown / Could not check and writes nothing.
- [x] Already at the target: `Up to date`, exit 0, nothing written.
- [x] Restart and trust instructions are printed where they apply (restart
      Claude Code with `laika-claude`; trust the hook in Codex with `/hooks`).
- [x] Tests in temp git repos cover: clean update, dirty refused, diverged
      refused, wrong SHA refused, network failure, staging self-check failure
      rolled back, interrupted switch recovered, config backup with other MCP
      servers untouched, no secret in any output, and `~/.laika/env`,
      `~/.laika/agents/*` and `~/.laika/device/*` byte-identical before and
      after.
- [x] `cli/README.md` documents the command.

## Notes / context

- No npm: the package is private and the checkout is the distribution
  (`cli/bin/laika`). No new dependency.
- Signed release tags are a follow-up hardening (plan L3), not this task.
- Does not touch device pairing (LAI-1050) or the V3 web shell (LAI-1048).

## Builder notes

- Branch `LAI-1051-laika-update` (LAI-1050 was taken by device pairing).
- **Deviation for review:** a board over plain http off loopback is refused for
  the update unless `--allow-http`; `--check` and `--dry-run` only warn. The
  owner's production board is `http://<ip>`, so a strict https-only rule would
  make `laika update` unusable there today.
- MCP config is hashed, not rewritten: no laika MCP entry names a checkout
  path, so there is nothing to re-apply; a change during the update fails it.
- `--dry-run` fetches nothing, so reachability and divergence are checked only
  by a real run.

## Review round 1 (PR #207) — fixed 2026-11-01T22:48:38Z

Reviewer's proposed defaults adopted, in new commits (no force-push):

- **B1** the source is anchored on this machine: a checkout remote (normalised:
  https / scp / ssh spellings match, user and `.git` ignored) or `--source`.
  A board over https or loopback may name a fork; only a loopback board a local
  path. `--allow-http` is accepted only with an anchored source.
  `--allow-downgrade` is needed for a target that is not a descendant of HEAD.
- **B2** marker written before any copy; copies removed in a `finally` on every
  path except an incomplete rollback; removed after recovery; swept at start
  with no marker; a `.bak` the refresh made is removed on rollback. Tests
  assert only `state.json` is left.
- **B3** the marker records original and post-write digests; putting back
  restores only what still holds what the update wrote, and moves the checkout
  only from the target (or previous) commit with a clean tree; otherwise
  "changed since — left alone". Recovery test with hooks on and user edits.
- **B4** non-loopback boards tested through an injected `fetch`, so the real
  transport rules decide; each new guard mutation-checked.
- Cheap items: `GIT_DIR`/`GIT_CONFIG_*` stripped, `protocol.allow=never` +
  https/ssh (+file where allowed), `transfer.fsckObjects`, `--` before the
  source, staging worktree from a killed run removed; README gains
  `laika version` and `laika doctor`.
- One refinement to the reviewer's rule: a local-path source is allowed from a
  non-loopback board **when it is the checkout's own remote** (or `--source`),
  because then this machine, not the board, chose it.

## Review round 2 should-fixes — 2026-11-01T23:27:27Z

- A matched remote is fetched by its own `git remote get-url` value (a local
  remote by its resolved path), never the board's spelling.
- `file://host/…` is refused as a source rather than crashing.
- `GIT_SSH` / `GIT_SSH_COMMAND` kept; the other overrides still stripped.
- Recovery test where the user commits on the detached HEAD after the crash.
- README: a hook file rewritten by a killed run before it was recorded is
  reported, not restored.
