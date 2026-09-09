---
id: LAI-166
title: '`board-presence` waits 20s for a chip that arrives in 1.9s alone — a third gate flake'
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-163
status: backlog
---

## Goal

`server/web/test/browser/board-presence.test.ts:212` — *"renders real people, and
the withheld one is still a person"* — fails under the full root gate and passes
alone:

```
under `pnpm test`:   not ok 1   duration_ms: 32299   locator.waitFor: Timeout 20000ms exceeded
                                waiting for locator('.presence-chip').first() to be visible
alone:                   ok 1   duration_ms:  1883   # pass 7  # fail 0
```

Both measured on `core` at 2026-09-09, same tree, minutes apart.

**Seventeen times its solo duration, against a 20s ceiling.** The other three
tests in the same suite pass under the gate, so it is not the browser failing to
start — it is this one wait, in the one test that needs the presence poll to
land before it can look.

## Why this is the third one and should be counted as such

- LAI-452: `cli/test/plugin-hooks.test.ts`, red 1 run in 2, `subtestsFailed`.
- LAI-456: `events.test.ts` *"replays right up to the limit"*, 466ms alone and
  5464ms under the gate, against a 5000ms default.
- This one: 1883ms alone, >20000ms under the gate.

**Three tests in three workspaces with the same signature** — fine alone, slow
enough under parallel load to cross a fixed deadline. That is not three flaky
tests, it is one property of the gate: it runs three workspaces concurrently and
every timeout in the repo was chosen against an idle machine.

A per-test bump fixes the instance and leaves the shape. **Whoever takes this
should decide whether the answer is local or repo-wide**, and say which, because
the next one is already out there.

## Acceptance criteria

- [ ] Reproduce under load and put the rate in the task, as LAI-452 asks. A
      figure like *"fails 4 in 5 gate runs, never alone"* is the finding.
- [ ] The cause is named. A 20s wait for a chip that takes 1.9s is not a
      slightly-too-tight budget — something is being starved, and the candidate
      is CPU contention between three workspaces' test runners plus a real
      Chromium. Confirm or refute it; do not assume it because it is written
      here.
- [ ] **A raised timeout is justified by measured work, not by the failure
      going away** — LAI-456's criterion, and it applies identically.
- [ ] If the answer is repo-wide (a concurrency cap, or workspaces run in
      sequence), say so and file it; do not quietly widen one number.
- [ ] Full gate `EXIT 0`, twice in a row.

## Notes

Found by CORE running the root gate for LAI-163, alongside LAI-165 in the same
file tree. **Not fixed here** — `server/web/` is SHELL's (D-031).

Distinct from LAI-452 (`area: cli`, a different test and a different symptom).
Filed separately rather than folded in, on §3's rule that a duplicate costs
CHIEF one review line and a lost discovery costs whatever it breaks — but the
three should probably be looked at together, and that is the point above.
