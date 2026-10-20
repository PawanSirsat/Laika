# polly-time — 2026-10-20

Owner-direct build of LAI-792 (an Omnigent-native orchestrator's time reaches
My day) through the orchestrator. Temporary worktree `Laika-polly-time/`,
branch `LAI-792-polly-time` from `master` 2faf0d7a. Not pushed, not merged.
Board card LAIKA-595 was already In progress and was not touched.

## 2026-10-20T05:46:00Z — LAI-792

**What changed**
- plugin/scripts/laika-activity-hook — a fourth kind of session, the
  Omnigent-native orchestrator: `t`/`r omnigent <epoch> <session>` to
  `events.log` at a turn's start and end, its Omnigent session id in
  `primary-sessions` at its start; header documents the rule and its one blind
  spot
- cli/src/activity-time.ts — `TurnEvent`, `TURN_AGENTS`, a lane per
  orchestrator session, turn ends as replies; `events.log` read once for
  prompts and turns
- cli/src/activity.ts — `laika time draft` ends with what the blocks were built
  from; cli/src/activity-store.ts — file table
- cli/test/activity-hook.test.ts (12 new cases), cli/test/activity-time.test.ts
  (3 new cases, machine fixture extended, one expectation follows the fixture)
- cli/README.md (and a false sentence removed: "an Omnigent primary that is not
  a Claude Code session runs no hooks"), plugin/README.md
- .tasks/review/LAI-792-…md; .tasks/backlog/LAI-797, LAI-798 (filed)

**Decisions**
- **Preference 1 held, with no new surface.** polly's brain is Claude Code
  under the Claude Agent SDK, which loads `~/.claude/settings.json`, so the
  hook `laika activity on` installed already ran at every polly turn and
  skipped it. Recognising it beat both a new CLI entry point (preference 2:
  polly would have to remember to call it every turn, an LLM habit, not a
  mechanism) and an Omnigent policy (see below).
- **Recognised by three of Omnigent's own marks**, all read in its installed
  source: `OMNIGENT_RUNNER_LAUNCH_HARNESS=claude-sdk` (`runner/identity.py`),
  the SDK's `CLAUDE_CODE_ENTRYPOINT=sdk-py` (`claude_agent_sdk`
  `subprocess_cli.py`), and no `OMNIGENT_TERMINAL_LAUNCH_SESSION_ID` (set only
  for terminals, `inner/terminal_lifecycle.py`). My own sub-agent environment
  confirmed the shape: the runner primary id is polly's, the terminal id mine.
- **Turns, not typed prompts.** A turn's start is also Omnigent waking polly
  when a sub-agent finishes. Without reading the message they cannot be told
  apart, so no turn is a prompt (the heatmap is unchanged) and turns draft as
  the primary session's activity, each end a reply — the same footing a
  Claude Code primary's replies have under D-088 item 9.
- **The lane is Omnigent's session id from the environment**, not the SDK
  session id from the payload: no payload is read on any orchestrator path,
  and one polly conversation stays one lane across the CLI's restarts.
- **Not an Omnigent policy.** Its `REQUEST` phase fires per user message, but
  a policy must be attached in polly's spec (shipped inside the installed
  package, overwritten on upgrade) or as a server-wide default (which would
  reach the sub-agents too), its callable must be importable by Omnigent's own
  Python, it is handed the message text, and `REQUEST` fails closed: an import
  error would deny every message the owner types.

**Discovered**
- `laika time draft --days 1` on the real data: 6 min for 2026-10-20. Replayed
  in a scratch copy with polly's 34 turns that day (times from its runner log,
  event names and times only): 3 h 43 min in 10 blocks — all orchestrator
  minutes "no task" → LAI-798.
- A block cannot carry an agent label: §6.4 refuses any other field → LAI-797.
- **Running the hook in a copied `~/.laika/activity` can start a real sync.**
  The copy's `next_sync_at` had passed, so `turn-end` launched
  `laika activity sync --background` with the scratch HOME; it stopped at "no
  token in ~/.laika/env" because only `activity/` was copied, and sent nothing.
  The real directory was untouched. Set `next_sync_at` far ahead before any
  replay.
- A child session polly defines itself on `claude-sdk` would look the same and
  count the same; recorded in the hook header and the README.

**Gate** (repo root). Run 1, after the last code edit: `pnpm test` 0 — server
3216 passed + 10 skipped of 3226 cases, web 2206/2206, cli 484 passed + 2
skipped of 486; `pnpm lint` 0; `pnpm format` 0.

After the Markdown-only commits (task files, this log) the machine ran at load
30–52 and three more `pnpm test` runs each exited 1 on timeouts alone (LAI-768):
- run 2: 10 server cases (`db/migrate`, `mcp/parity`, `tooling/build` — the
  built server never healthy); those three files alone: 67/67, exit 0.
- run 3: cli `activity-lookback` (120 s test timeout) and web
  `column-statuses` (`page.goto` 30 s); `pnpm -r` then stopped before the
  server. Alone: web 19/19 exit 0; look-back 26/27 once (a different case,
  "the hard deadline was reached" after 785 s), then 27/27 exit 0 at load 8.
  Its two timing cases run on `master`'s cli and on this branch one after the
  other: both pass, 3.12 s / 15.81 s against 3.08 s / 15.80 s.
- run 4: server 3213 passed + 13 skipped, one file failed at suite level —
  `tooling/environment-posture` `beforeAll` over 60 s; alone 13/13, exit 0.
  Web 2206/2206, cli 484 + 2 skipped of 486.
`pnpm lint` 0 and `pnpm format` 0 after the last edit.

## 2026-10-20T09:25:00Z — LAI-792, review round 1

Merged local `master` (badb2d06: LAI-788, D-089, D-090) first; clean.

**What changed**
- plugin/scripts/laika-activity-hook — D-090's check: on Claude Code's prompt
  on an Omnigent orchestrator's turn or in an Omnigent primary, at most 4 KB
  read, one question (`"prompt"` value begins `[System: `), cleared, rest
  drained; the orchestrator writes `w` for a runtime turn, a primary no `p`;
  `sdk-py` exactly; header reworded (the prompt promise, two exceptions,
  turns the person started)
- cli/src/activity-time.ts — `TurnEvent.kind` (`start`/`wake`/`end`),
  `personTurns`: an end is kept only after a `t` in its session;
  `read.runtimeTurns`; cli/src/activity.ts — `laika time draft` says how many
  runtime turns it left out; cli/src/activity-store.ts — file table
- cli/test/activity-hook.test.ts, cli/test/activity-time.test.ts; READMEs
- .tasks/review/LAI-792-…md; .tasks/backlog/LAI-805 (filed)

**Decisions**
- **`w`, not nothing, for a runtime turn.** The `r` that ends it must be
  dropped and `Stop` cannot say which turn it ends; an explicit start lets
  the drafter pair each end with the start before it, a torn or missing line
  costs at most that one turn, and the preview can count what it left out.
- **An end with no start counts nothing** — D-090's safe direction.
- **The check is Claude Code's prompt only**, on the two Omnigent paths D-090
  names. A codex or other-agent primary is unchanged (a test says so).
- **Peek 4 KB.** The payload's fields before `prompt` are a session id, two
  paths and two short words, well under it.

**Discovered**
- Item 2 does happen: Omnigent 0.17.0 posts its wake notice to every parent
  but a codex-native one, and the claude-native harness pastes it into the
  terminal as typed input. The `p` is gone; the replies Claude Code gives it
  still draft from the transcript → LAI-805.
- The review quoted the notice as "1 results"; 0.17.0's template says
  "1 result" for one and "N results" otherwise. The fixture quotes the source.

**Gate, round 1** (one repo-root run after the last code edit, load 15–53):
`pnpm test` **1** — cli 530 passed + 2 skipped of 532, web 2231/2231, server
3275 passed + 10 skipped, 3 failed of 3288: all three `tooling/build.test.ts`
("built server never became healthy", LAI-768). `build.test.ts` alone: 15/15,
exit 0. `pnpm lint` 0. `pnpm format` 0.
