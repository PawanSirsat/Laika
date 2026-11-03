---
id: LAI-1107
title: 'Launcher: transient prepare and workspace failures retried, hand prepares left alone, sessions ended, reuse re-checked'
area: cli
assignee: shell/belka
priority: p2
depends-on: [LAI-1039]
discovered-from: LAI-1039
status: review
started: 2026-11-03T17:25:09+05:30
finished: 2026-11-03T17:42:50+05:30
---

## Why

The round-3 review of PR #254 (LAI-1039, merged at `9c3388ef`) found four
places where the launcher fails closed but loses work. None starts anything it
should not; each drops or strands something it should have kept.

## Acceptance criteria

- [x] **A transient `prepare` failure is retried, never handled.** `laika agent
      handoff prepare` exits with its own code (and a README line says which)
      when it could not read the board or could not fetch/ls-remote the
      checkpoint tag, distinct from `1` for a refusal. The launcher retries that
      code with a bounded backoff, as it does `READ_FAILED`, and never marks the
      event handled. The same for a transient `ls-remote` or fetch failure in
      `prepareWorkspace` for a work request (today `workspace_refused`, handled).
- [x] **A hand-prepared offer is left alone.** The launcher writes a marker under
      `runs/<offer>/` before it calls `prepare`, and reuses a prepared record
      only when that marker is there. A record it did not make starts nothing
      and is audited.
- [x] **A session opened for a launch that throws is ended**, not left to lapse.
- [x] **A reused worktree is re-checked before start**: on the expected branch,
      `HEAD` at the recorded commit or a descendant of it on that branch, and a
      clean status. Otherwise refused (audited), never started.
- [x] Each fix has a test that goes red when the fix is undone.

## Notes

- SHELL, `cli/` only: `cli/src/agent-launcher.ts`, `cli/src/agent-handoff.ts`,
  `cli/src/agent-workspace.ts`, their tests, `cli/README.md`.
- Dispatched by polly (Belka) from the round-3 review; PR into `master`.

## Evidence

- Tests: `cli/test/agent-launcher.test.ts` describe *LAI-1107* (8 tests),
  `cli/test/agent-handoff.test.ts` describe *LAI-1107: prepare tells…*
  (4 tests), `cli/test/agent-workspace.test.ts` describes *LAI-1107: a remote
  that could not be reached…* (3) and *LAI-1107: reusedWorktreeProblem* (5).
- 21 mutations, each undoing one fix, each turned its own test red and was
  restored by checksum (the log lists them).
- One existing assertion changed by design: *starts nothing when prepare
  refuses* asserted `runs/<offer>/` absent; the marker now precedes prepare,
  so it asserts the directory holds only `launcher-prepare.json`.
