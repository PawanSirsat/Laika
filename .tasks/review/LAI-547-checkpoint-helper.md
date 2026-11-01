---
id: LAI-547
title: 'Checkpoint helper: isolated worktree, safe staging, no concurrent git, push then register with retry'
area: cli
assignee: shell
priority: p1
depends-on: [LAI-542, LAI-545]
discovered-from:
status: review
started: 2026-10-30T04:50:00Z
finished: 2026-10-30T05:22:00Z
---

Implements **proposal §4.3.1, §4.7** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

`laika agent checkpoint` saves the agent's work safely: it pushes the
task's own branch from the task's own worktree, then registers the checkpoint,
retrying registration with the same key if it fails.

## Scope

- Runs in the task worktree on the task branch only.
- Stages tracked files or explicitly listed ones; refuses secret-pattern files.
- Waits/refuses while `index.lock` exists or a tool is running.
- Never force-pushes, never pushes `master`.
- Push first, register second, idempotency key persisted locally for retry.
- Push the work branch **and** the lightweight tag `laika-ckpt/<LAI-NNN>/<checkpoint-id>` at the checkpoint SHA, then register.
- `laika agent checkpoints prune --dry-run`: list `laika-ckpt/*` tags due for removal (90 days after Done/Cancelled, configurable). It never deletes; the operator decides.

## Out of scope

- Receiver flow (LAI-548)
- Resource triggers (LAI-552)

## Acceptance criteria

- [x] A file matching a secrets pattern is refused and named (asserted).
- [x] With `index.lock` present the command refuses with a clear message and does nothing.
- [x] A `master` branch or a non-fast-forward push is refused without `--force` being reachable.
- [x] Push succeeds + registration fails → next run registers with the same key and the server shows one checkpoint.
- [x] Repo-root gate exits 0.
- [x] After a checkpoint the remote has the tag `laika-ckpt/<LAI-NNN>/<checkpoint-id>` pointing at exactly the registered SHA (asserted against a bare remote).
- [x] After registering, the helper prints "Verification pending" until the server reports `verified`, and after 10 minutes "Verification pending — no push notice from GitHub yet" with the hint to check the webhook's recent deliveries and use Redeliver.
- [x] `prune --dry-run` lists exactly the due tags and deletes nothing (asserted by `git ls-remote` before and after); there is no non-dry-run mode in this task.

## Tests and UI evidence required

Node tests in temp git repos with a bare remote; a real server on your own port for registration.

## Dependencies

`depends-on: [LAI-542, LAI-545]`.

**Blocked on decisions D-115 / D-116 (proposed).** Do not start until both are approved as proposal §8 describes. Board tag `blocked-on-decision`.

## Role / machine

SHELL on Belka. Owner area: `cli` (SHELL).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

2–3 days, confidence M.

## Branch

`LAI-547-checkpoint-helper`

## Migration / rollout notes

None.

## Builder notes (SHELL, Belka, 2026-10-30)

- D-115 and D-116 were approved on 2026-10-29 (DECISIONS.md, PR #99), and
  Phase 3 (#153) is on `master`, so the "blocked on decision" line above no
  longer holds; the task was dispatched by polly on that basis.
- The dispatch widened the scope inside `cli/`: `checkpoint status`, `note`
  and `consent`, and the hook trigger (PreToolUse / PostToolUse / Stop /
  SessionEnd). All in `cli/` plus the comment line of
  `plugin/scripts/laika-agent-hook` (SHELL's).
- "after 10 minutes" is measured by the board's clock and is configurable
  (`LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS`, SPEC §4.70 "configurable"); the
  e2e test sets it to 0 against the real board, the unit test asserts the
  ten-minute boundary.
