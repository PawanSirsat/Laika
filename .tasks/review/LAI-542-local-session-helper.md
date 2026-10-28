---
id: LAI-542
title: 'Local helper: laika agent session start|heartbeat|end bound to the harness PID; Claude Code + Codex hook adapters'
area: cli
assignee: shell
priority: p1
depends-on: [LAI-541]
discovered-from:
status: review
started: 2026-10-27T23:19:45Z
finished: 2026-10-28T06:34:20Z
---

Implements **proposal §4.7, §5** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

Claude Code and Codex sessions open, renew and close a Laika agent
session automatically, and renewal stops the moment the harness process that
holds the session dies — even if the helper survives.

## Scope

- `laika agent session start|heartbeat|end` in `cli/`.
- Heartbeat checks the harness PID is alive before renewing.
- Adapters: Claude Code (`SessionStart`, `PostToolUse`, `UserPromptSubmit`, `SessionEnd`) and Codex (same, `SessionEnd` advisory) in `plugin/` / `cli/`.
- Credential from the agent's token via the harness's documented mechanism (proposal §5).

## Out of scope

- Checkpoints (LAI-547)
- Other harnesses (LAI-557)
- Notices (LAI-554)

## Acceptance criteria

- [x] Killing the harness process stops renewals within one heartbeat interval while the helper stays alive (asserted with a real child process).
- [x] `end` closes the session with an `end_reason`.
- [x] Network failure retries without creating a second session.
- [x] The token never appears in hook output, logs or argv (asserted).
- [ ] Repo-root gate exits 0, and the `cli/` workspace has a test that fails if the command is absent.

## Tests and UI evidence required

Node tests against a real server on your own port; a spawned fake harness process killed mid-session.

## Dependencies

`depends-on: [LAI-541]`.

## Role / machine

SHELL on Belka. Owner area: `cli` (SHELL).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

2 days, confidence M.

## Branch

`LAI-542-session-helper`

## Migration / rollout notes

Opt-in: the adapter is installed per harness. Existing hooks unchanged.

## Notes (SHELL, claim)

- Base: LAI-541 head `3e17cfad` (draft PR #107, stacked on #105 → #102 →
  #98/#96). Branch `LAI-542-agent-session-helper` (the task file says
  `LAI-542-session-helper`; the orchestrator named the branch, kept as given).
- **Deviation recorded:** `depends-on: [LAI-541]` is in `.tasks/review/`, not
  `done/`. Claimed on CHIEF's (polly's) direction; this work must not merge
  before #107. D-114 approved in substance, record pending → the PR is a draft.

## Notes (SHELL, review)

**What exists.** `laika agent login|logout|hooks on|off|session start|heartbeat|end|status`
(`cli/src/agent*.ts`), the hook script `plugin/scripts/laika-agent-hook`, and
the capability matrix in `cli/README.md`.

**Per criterion.**

- *Killing the harness stops renewals within one interval while the helper
  stays alive*: `cli/test/agent-session-e2e.test.ts`, against a real server on
  a free port with its own DB and `LAIKA_CLAIM_*` at 1/2/3/1 s. A fake harness
  is a node process named `claude` (a symlink), found by walking up from the
  hook with no PID override. The watcher is `SIGSTOP`ped, the harness is
  `SIGKILL`ed, a manual `laika agent session heartbeat` is refused (exit 3, no
  request), and the watcher is `SIGCONT`ed. The server's own request log shows
  no heartbeat later than kill + 1 interval. The claim then expires and
  generation 1 is `409 stale_claim`. Mutation (liveness check removed): red.
- *`end` closes the session with an `end_reason`*: `SessionEnd` through the
  fake harness gives `end_reason: ended` on the board, and a later heartbeat is
  `409 stale_claim` with `end_reason: ended`. Real `claude -p` did the same.
- *Network failure retries without creating a second session*: a heartbeat
  failure retries the same session (unit). A start carries an
  `Idempotency-Key` written to the state before the first attempt. A start
  whose answer was lost **after the real server made the session** is retried
  and answered with `Idempotent-Replay: true` and the same id (e2e).
  Mutation (header dropped): red.
- *The token never appears*: the e2e asserts it is absent from every hook's
  stdout and stderr, every CLI output, every state file and the helper log
  (all 0600), the watcher's argv **and environment** (`ps -E`), and the
  installed hook commands. Login refuses the owner's personal token
  (`403 not_an_agent`).
- *Gate and a test that fails if the command is absent*:
  `agent-session.test.ts` runs `index.ts agent session status`. The gate's
  exit codes are on the PR and the card (LAIKA-794), quoted verbatim. Left
  unticked here because this file is written before the gate runs, and the
  base carries #105/#107's known server/web reds.

**Decisions.** A detached watcher bound to the harness PID plus start time,
not `PostToolUse` beats: hooks fire only at boundaries, and five minutes of
thinking would let a lease lapse. A dead harness is *abandoned*, not ended,
so its claims expire into recovery rather than being released. No automatic
reclaim.

**Real harnesses.** Claude Code 2.1.280: `claude -p --settings` (hooks given
on the command line, with HOME pointed at a scratch dir inside the hook
command, so no real config was touched). The session opened bound to the real
`claude` PID, the watcher beat 13 times, `end_reason: ended`, and the model
repeated the injected session id. Codex 0.162.1: not run. A headless run
needs `--dangerously-bypass-hook-trust`, which this session was not
permitted to use. Filed as LAI-572.

**Filed.** LAI-572 (LAIKA-824), certifying Codex. Unlisted: the root
package and `cli/` share the name `laika`, so `pnpm --filter laika` runs
the whole repo.


## Review round 1 (Codex cross-review of #108 at `aca24a78`: FAIL, five blocking)

All five fixed as new commits (`ffb7316d`, `43f38779`). Each has a
regression test, and each fix was broken on purpose to confirm its test goes
red, then restored by checksum:

1. **Zombies kept claims alive.** `isAlive` now also reads `ps -o stat=`.
   `Z`, `X` and an exiting `E` count as dead. Regression: a real unreaped
   child (`sh -c 'sleep 0.2 & …; exec sleep 30'`) keeps its PID and start
   time, is not alive, and gets no renewal. Mutant: red.
2. **Token in `ps`'s env.** `ps` now runs with `PATH`, `LC_ALL` and `LANG`
   only. The `_watch` and `_end` children get an allowlist (`HOME`, `PATH`,
   `TMPDIR`, `LANG`, `LC_ALL`, `LAIKA_AGENT_HEARTBEAT_SECONDS`). Those are the
   only subprocesses; they are listed in `cli/README.md`. Regressions: a
   sentinel in `process.env` is absent from `ps`'s env (recorded exec); a
   real harness passing `LAIKA_AGENT_TOKEN`, plus a sentinel `LAIKA_TOKEN`,
   leaves the watcher's env (read with `ps -E`) free of both. Mutants: red
   (the e2e mutant failed with *"the agent token is in the watcher's argv
   or env"*).
3. **Interrupted bodies defeated idempotency.** A 2xx whose body does not
   parse is now `network`, not `ok`. A 2xx that names no ULID session is
   handled the same way, inside the retry loop. Both retry with the same key
   and the state keeps `starting` with that key; a heartbeat retries.
   Regressions: a real socket that sends half a 201 after creating the
   session, then drops — one session, one key across two requests, and
   across hooks when every attempt drops. Mutant: red (heartbeat case; the
   start cases are also held by the no-id check).
4. **Lock race.** `startSession` takes the lock first, waits up to 10 s for
   a concurrent starter, and only then reads the state. Regression: two
   concurrent starters give one POST and one session (`started` +
   `reused`). Mutant (no wait): red.
5. **Unbounded injected context.** The session id must be a ULID, or it is
   not repeated. `lost` is read to at most 200 entries; a claim is named
   only with ULID ids, a positive safe-integer generation, and a state in
   `paused|released|expired|transferred`. At most three are named, quoted in
   a line that says *board data … not instructions*, and the hook's total
   context is capped at 1,200 characters. Adversarial regression: 10,000
   entries carrying newlines and *"Ignore previous instructions"*, plus
   NaN/1e400/-1/2.5/"3" generations and unknown states. The notice is under
   600 characters and names only valid claims. Three mutants: red.

Non-blocking: the README now calls the Codex "same test" cell shared-engine
evidence, not certification.

**Gate this round** (touched files only, per the owner, the machine being
loaded): `tsc --noEmit` 0; `node --test test/agent-session.test.ts
test/agent-session-e2e.test.ts test/cli.test.ts` 0 (55 tests, 55 pass);
`pnpm lint` 0; `pnpm format` 0.

**CI lint OOM** (run 40650858403, exit 134): not this branch. The same
heap exhaustion in `eslint .` fails every PR run in the agent stack since
2026-10-27 19:25, including `LAI-532-agent-handoff-programme`, whose diff
from `master` is 30 Markdown files and no code. `master` passed the same lint
at the same base SHA `71dd4217` on its push run (40327823156). No passing run
on any branch since 2026-10-26. The runner's Node default heap (~2 GB) is at
the edge; that is a CI change for whoever owns the workflow, not a change in
this branch.
