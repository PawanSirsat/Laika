---
id: LAI-776
title: 'Token usage: data arrives only at session start or end, and a sync with new bytes rewrites 4.6 MB'
area: cli
assignee: owner-direct
priority: p3
depends-on: []
discovered-from: LAI-769
status: review
started: 2026-10-18T03:46:13Z
finished: 2026-10-18T05:16:18Z
---

## Goal

Two measured costs LAI-769 left as they are:

1. **Freshness.** The usage step runs inside `laika activity sync`, which the
   hooks start on session start and end when due. A session that runs for
   hours reports its tokens only when it ends. REPORT.md §1b suggests a
   throttled `Stop` trigger (Claude Code), which fires every turn; the hook
   would only launch the detached sync when `next_sync_at` has passed.
2. **The step with something new** costs about 90 ms on the measured machine
   (785 transcripts): it parses and rewrites `usage-data.json`, 4.6 MB holding
   every reply of the 31-day window by message id. The step with nothing new is
   17–19 ms in a fresh process and is not the problem.

## Acceptance criteria

- [x] Tokens from a running session reach the board within one sync interval,
      with no work on the prompt path (the hook stays fork-free under zsh).
- [x] A sync with new bytes in one transcript costs under 50 ms, measured on a
      machine with ~800 transcripts, and the dedupe across files still holds.
- [x] Root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Builder notes (at review)

Folded into LAI-773's branch `LAI-773-token-phase5` (worktree
`Laika-token-phase5`, from `master` 4d48470d), because the runaway alert is
useless if tokens arrive only at session end. Not pushed. No new dependency.

**Against each criterion**

1. **Tokens from a running session within one sync interval, nothing on the
   prompt path.** `plugin/scripts/laika-activity-hook` gains a `turn-end`
   mode, installed by `laika activity on` as Claude Code's `Stop` hook (every
   turn's end; no matcher; timeout 5 — code.claude.com/docs/en/hooks). It
   drains stdin exactly as the prompt path does (the `Stop` payload carries
   `last_assistant_message`; it is never read), counts nothing, prints
   nothing, exits 0, does nothing for automated sessions, and launches the
   detached `activity sync --background` only while collection is on and
   `next_sync_at` has passed. **Not due, under zsh it forks nothing** — tested
   with `fork()` refused, against the same hook when due as the control. The
   prompt path is unchanged. A machine set up before this gets the hook by
   running `laika activity on` again. Only Claude Code: no other agent here
   documents a per-turn event.
2. **A sync with new bytes in one transcript under 50 ms with ~800
   transcripts, dedupe intact.** Claude Code replies now live one file per
   local day (`~/.laika/activity/usage-days/`) with a small index and a
   per-day row cache; only the days a change can reach are counted again.
   `usage-data.json` 5.2 MB → 339 KB. Format 4; a format-3 file is split
   into days without re-reading a transcript (130 ms once). Measured on this
   Mac's real `~/.claude/projects` (779 transcripts, 2.12 GB; a hard-link
   mirror read-only, a synthetic transcript appended to, usage fields only,
   fake `send`, fresh node process per run):

   | case | before (format 3) | after (format 4) |
   | --- | --- | --- |
   | new bytes in one transcript | 100.6–110.9 ms | 28.8–37.6 ms (re-measured by the main session: 28.3–32.2 ms, load ≈ 9) |
   | nothing new | 9.9–10.5 ms | 10.2–12.3 ms |
   | full first read | 3772 ms | 4053–4173 ms |

   Dedupe: of 74,716 message ids, 376 appear in more than one file and none
   of those spans two local days; 3 ids span two days within one file (a
   reply streaming across midnight), so a line is looked up on its own day and
   the neighbouring day within an hour of midnight. New tests: a resumed
   session's copy read a sync later counts once; a reply across midnight
   counts once; old and new readers give identical rows for all 26 days on
   the real mirror. The 50 ms wall-clock check is opt-in (`LAIKA_PERF=1`,
   LAI-779); the default gate counts the files opened and written.
3. Root gate — see LAI-773's gate section (one gate for the branch).

**Commits** on `LAI-773-token-phase5`: 31cb7a88 (claim), ba984849 (migration
0040), 9b2e9821 (server), f6802de1 (cli + plugin, LAI-776), 231eb603 (web),
045236d6 (SPEC + D-087).

**Gate and screenshots**: see LAI-773's notes and the log entry.

## Builder notes — review round 1 (2026-10-18)

The round-1 review of LAI-773 (one branch for both) touched this task's side
once: **ALSO FIX 5**, in d2ba8c86. The collector now sends `excluded` keys
only when Claude Code on that machine sends its metrics to this board
(`telemetryToBoard`, `cli/src/activity-sync.ts`), from the sync, `backfill`
and `status`. Three mutations, three red tests, recorded in LAI-773's notes.
Nothing on the per-turn sync or the day-partitioned records changed, so
criteria 1 and 2 stand as measured. Gate: LAI-773's round-1 section, one
gate for the branch.
