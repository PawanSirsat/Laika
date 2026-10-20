---
id: LAI-792
title: 'An Omnigent-native primary session (polly) leaves no local signal, so the time a person types to it cannot be drafted'
area: cli
assignee: owner-direct
priority: p2
depends-on: [LAI-787]
discovered-from: LAI-787
status: in-progress
started: 2026-10-20T05:17:26Z
---

## Goal

The time a person spends typing to Omnigent's own orchestrator reaches their
drafts, without Laika reading Omnigent's private database.

## What LAI-787 found

LAI-787 makes a primary **Claude Code** session count as the person's: the
hook compares `OMNIGENT_TERMINAL_LAUNCH_SESSION_ID` with
`OMNIGENT_RUNNER_PRIMARY_SESSION_ID` (verified in Omnigent's installed source:
`runner/_entry.py`, `host/connect.py`, `inner/terminal.py`). But the owner's
recent primaries — `polly` — are Omnigent's own agent: `chat.db` shows them as
kind 1 with no `external_session_id`, they write no `~/.claude` transcript and
run no Claude Code hook. Measured over 2026-10-14..20 the drafter found 7.3 h
for the owner, a floor well under the research's figure, largely for this
reason.

## Acceptance criteria

- [ ] A supported way for an orchestrator to tell the collector "the person
      typed now" — a hook Omnigent can call, or a documented event file —
      metadata only, never the text; or a decision that such time is entered
      by hand.
- [x] Gate: test, lint, format exit 0.

## Delivered (LAI-792, owner-direct, branch `LAI-792-polly-time`, not pushed)

**Mechanism: the hook Laika already installs — no new configuration.** The
"runs no Claude Code hook" above was not so. polly's brain is Claude Code
under the Claude Agent SDK (Omnigent 0.17.0's `claude-sdk` harness,
`inner/claude_sdk_executor.py`): it passes `skills="all"` and no
`setting_sources`, so the SDK (`claude_agent_sdk` 0.2.164,
`_apply_skills_defaults`) loads `["user", "project"]` — the owner's
`~/.claude/settings.json`, where `laika activity on` put the hook. It writes
no transcript only because Omnigent passes `--no-session-persistence`.
Measured in polly's own runner log on 2026-10-20 (event names and times only,
never a message): `UserPromptSubmit` and `Stop` hooks fired at every turn, all
exit 0, and Omnigent registers no `Stop` callback of its own — so Laika's hook
ran, and skipped every turn as automated (`OMNIGENT=1`, no terminal id).

- `plugin/scripts/laika-activity-hook` — a `claude-code` hook with `OMNIGENT=1`,
  `OMNIGENT_RUNNER_LAUNCH_HARNESS=claude-sdk` (the host's stamp for the session
  the runner was launched for, `runner/identity.py`), `CLAUDE_CODE_ENTRYPOINT`
  `sdk-*` (the SDK's, `subprocess_cli.py`), no `OMNIGENT_TERMINAL_LAUNCH_SESSION_ID`
  and a plain runner primary id is the orchestrator: a turn's start appends
  `t omnigent <epoch> <session>` and its end `r omnigent <epoch> <session>` to
  `events.log`; its start keeps the session in `primary-sessions`. No payload
  read, no `p`/`s` line, no repo, no skip-sessions. Fork-free under zsh.
- `cli/src/activity-time.ts` — each orchestrator session is a lane; each turn
  end is a `reply`, no turn is a `prompt`; minutes count once beside every
  other lane. `cli/src/activity.ts` — `laika time draft` prints what the
  blocks were built from, Omnigent turns included. `activity-store.ts` table,
  `cli/README.md`, `plugin/README.md`.
- Tests: hook 12 new cases (both shells: lines and no text kept, the start,
  six sub-agent shapes skipped, bad ids, CI/skip/off; the due sync; fork-free),
  drafter 3 (the lane, once-only beside Claude Code and prompts with two
  orchestrators, the heatmap ignoring `t`/`r`) and the machine fixture. Each
  shown failing first. 15 mutations of the hook and the drafter, each red,
  each restored by checksum.

**What the owner configures:** nothing new. Activity on (`laika activity on`,
already done), sharing and *Draft my time* on (LAI-787/LAI-791), and the
installed checkout the hook path points at (`~/laika`) updated once this
merges.

**Replayed on this Mac (scratch copy of `~/.laika/activity`, removed after):**
`laika time draft --days 1` for 2026-10-20 drafted **6 min** with the hook as
installed; with polly's 34 turns that day (00:22–10:51, times from its runner
log) written as this hook writes them, plus one live run of this hook, it
drafted **3 h 43 min in 10 blocks**, "35 Omnigent orchestrator turns". A replay,
not a live capture: the live hook is the owner's checkout, outside this task.

### For the reviewer

- **The signal is "a turn of the person's primary started / ended", not "the
  person typed now".** A turn's start is also Omnigent waking polly when a
  sub-agent finishes, and only the message — never read — tells them apart. So
  no turn is counted as a typed prompt (heatmap unchanged); turns draft time as
  the primary session's activity, as a Claude Code primary's replies already
  do (D-088 item 9). The person still confirms the day.
- **A child session polly defines itself on `claude-sdk`** (`spawn: true`)
  carries the same environment and would count the same. polly's declared
  sub-agents are terminal harnesses or `pi`, and are skipped.
- **An `omnigent`/`polly` label on a block** needs SPEC §6.4 (any other field
  is `422`), the server and the web → filed LAI-797. **Every orchestrator
  minute is "no task"** (its lane has no repository for a commit to tie) →
  filed LAI-798.
- Running the hook's `turn-end` in a scratch copy of `~/.laika/activity`
  launched a real background sync, because the copy's `next_sync_at` had
  passed; it stopped at "no token in ~/.laika/env" (only `activity/` was
  copied) and sent nothing. Neutralise `next_sync_at` first next time.
- **Gate.** After the last code edit: test 0, lint 0, format 0. Three later
  full runs (only Markdown changed) exited 1 on load timeouts at load 30–52,
  each failing file passing alone — listed in `logs/polly-time-2026-10-20.md`.

## Review round 1 — CHANGES REQUIRED (2026-10-20, through the orchestrator)

**B1 (blocker)** — turns Omnigent starts itself (a sub-agent finishing, a
timer, a terminal going idle) are counted as the owner's time: each writes
`t`, and the `r` after it counts too, so a night of wake-ups drafts the whole
night. The owner chose to let the hook check the prompt — **D-090**.

Required: (1) on the Omnigent orchestrator's `prompt` only, read at most a few
KB of stdin, ask whether the prompt field begins `[System: `, clear it, drain
the rest; a runtime turn writes another letter or nothing; the drafter drops
the `r` that ends a runtime turn; both `"prompt":"` and `"prompt": "`; a
fixture quoting Omnigent 0.17.0's notice template; a night of notices 10
minutes apart drafts nothing while a person's turn among them still drafts.
(2) The LAI-787 Claude Code primary path too, if the notices reach it as
prompts — check, and say. (3) `sdk-*` narrowed to `sdk-py`; `sdk-cli` among
the skipped shapes. (4) Docs per D-090 item 3: "Read the prompt" reworded,
"one exception" now two, these turns no longer called "yours", "nothing to
configure" names a host-launched runner, the no-marker-under-HOME test on the
Omnigent path. (5) This file back to in-progress, AC1 unticked.

