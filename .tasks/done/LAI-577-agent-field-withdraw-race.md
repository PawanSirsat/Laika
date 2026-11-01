---
id: LAI-577
title: 'agent-field withdraw race test fails on master CI and blocks the deploy: decide product race or test timing, and fix it'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-538
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-28T18:29:03Z
finished: 2026-10-28T18:58:40Z
---

Filed by SHELL (Belka, dispatched by CHIEF), 2026-10-28. Board card LAIKA-830,
tag `p0`.

## Why

CI / Deploy run 40702908482, attempt 2, on `master` `fe49255c` (PR #106 merged
via #111) went red on one browser test, which blocked the production deploy:

```
server/web/test/browser/agent-field.test.ts:1263
'a withdraw confirmed after the read caught up to the earlier one still shows'
settledRow (agent-field.test.ts:1082) called from :1321
  'ag-laptop' !== ''      expected '' (no agent), actual 'ag-laptop'
server/web: 3554 pass / 1 fail
```

The same test passed in both #111 CI runs and locally, so it is intermittent.

## Scope

- Decide with evidence whether this is (a) a **product race**, where the drawer
  shows the old agent after a confirmed withdraw, or (b) a **test timing**
  problem, where the test asserts before the state settles or its fake
  responses arrive in an order the real app cannot produce.
- (a): fix the product, and keep or strengthen the test. (b): fix the test so
  it waits on the real settled state, without weakening what it proves.

## Acceptance criteria

- [x] Root cause classified (a) or (b), with reproduction evidence recorded here.
- [x] Breaking the fix on purpose turns the test red; the file is restored by checksum.
- [x] `agent-field.test.ts` green 20+ runs in a row, including under CPU load.
- [x] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
- [x] PR into `master` opened (not draft); its CI run's conclusion reported.

## Role / machine

SHELL on Belka. Owner area: `web` (SHELL).

## Branch

`LAI-577-agent-field-withdraw-race`

## Rollout

Merging the PR deploys.

## Submitted (SHELL, 2026-10-29)

**Root cause: (a), a real product race**, reproduced locally with the CI
symptom, and not a test timing problem.

`AgentRow.tsx` retired an outdated confirmation through an effect that
cleared *whatever* was confirmed when it ran:
`useEffect(() => { if (retired) setConfirmed(undefined); }, [retired])`.
React runs a passive effect after paint, and flushes any pending one before it
processes the next update. So when the save's answer lands between the read's
render and that effect, the answer's `setConfirmed(B)` is queued first and the
effect's clear lands after it. B is lost and the drawer shows the previous
agent. Only a later successful read can correct it; in the test every read
after the save fails, as it can in production.

**Evidence.**
- The test as written was green 20/20 at rest, 32/32 under 8-way parallel load,
  18/18 with Chromium CPU throttling at rates 4, 8 and 16 (throttle confirmed by
  duration: 0.5 s → 2.3 s → 5.8 s) and 36/36 with a release-delay sweep. The
  window is too narrow to hit by load alone.
- Instrumented (scratch, restored by checksum), a passing run logged the read's
  render judging the confirmation stale at 80438, the effect at 80442, and the
  save's answer at 80444: **2 ms** after the window closed.
- Releasing the save a few ms after the read, with the page throttled at rate 4,
  reproduced it once in four runs, as `'ag-laptop' !== ''` from `settledRow`
  (the CI assertion). That run's log shows the predicted order: render
  `retired=true` (37869) → save answers `none@T2` (37884) → effect runs (37890)
  → render with the confirmation gone, props `ag-laptop` (37898).
- In CI the neighbouring tests ran about three times slower than here, which
  widens that window.

**Fix** (`0b0a2cdc`). The effect retires only the confirmation it judged stale,
by identity: `setConfirmed((now) => (now === stale ? undefined : now))`. A newer
one queued before it runs survives.

**Test** (`a5e91f18`). Two new cases, select and withdraw: *"… answered inside
the read's render still shows"*. Both answers are held **in the page** (a
`fetch` wrapper, after each request really reached the server, so each carries
real data). The read is released, and the save's answer is released from a
`MutationObserver` the moment the read's render commits. The signal is the t1
card gaining its `.agent-chip`, which only the read can cause. The observer
runs at the end of that render's task, before React's effects task, so the
window is hit every time. The test asserts the order it produced (`read
released, read committed, save answered`) and the settled row. The two
existing version-race tests stay; they cover the looser order.

**Break-the-fix.** With the old unconditional clear put back (anchor confirmed,
restored by SHA-256 checksum), the new cases failed **10/10 runs, both
variants**: withdraw `'ag-laptop' !== ''` (the CI symptom), select
`'ag-laptop' !== 'ag-desktop'`. So the race hit select too; CI caught the
withdraw case by chance.

**Stability.** `node --test test/browser/agent-field.test.ts` (server/web), the
whole file: 35/35, exit 0, **45 times**: 1 timing run, 20 in a row, and 24
under 6-way parallel load (load average to 25 on 10 CPUs).

**Filed:** **LAI-581** (card LAIKA-834). The first full gate on this branch
exited 1 on one unrelated test, `agents-tab.test.ts:558` (a rename read before
the list re-rendered). Alone that file was 20/20 three times. LAI-580 was taken
on the board, though not yet in git, so the id is LAI-581.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #119.
