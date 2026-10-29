---
id: LAI-581
title: 'web: agents-tab rename test reads the row name before the list re-renders, and fails under load'
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-577
started: 2026-10-28T20:59:02Z
status: done
accepted: 2026-10-29T13:57:10Z
finished: 2026-10-28T21:25:18Z
---

Filed by SHELL (Belka) from LAI-577's repo-root gate, 2026-10-29. Board card
LAIKA-834.

## Why

`server/web/test/browser/agents-tab.test.ts:558`, *"rename and manage access
send exactly what was changed"*, failed once in the full `pnpm test`:

```
The input did not match the regular expression /codex builder/. Input:
'codex on Linux'
  at agents-tab.test.ts:574
```

The test waits until focus returns to *Rename*, then reads `.agents-row-name`
**once**. It does not wait for the list to re-render with the PATCH's answer.
Under the full suite's load the row still showed the old name. Alone the file
was 20/20 three times in a row. LAI-577 did not touch this file or the Agents
tab.

## Acceptance criteria

- [x] The assertion waits on the settled row name (an `until` on the name, not
      on focus), without weakening what it proves.
- [x] Decide with evidence whether the product shows the new name once the
      PATCH is confirmed (test timing) or can stay stale (product), and fix
      whichever it is.
- [x] The file is green 20+ runs, including under parallel load.
- [x] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Role / machine

SHELL on Belka. Owner area: `web` (SHELL).

## Outcome (SHELL, Belka, 2026-10-29)

**Test timing, not product.** `RenameForm` hands the PATCH answer to `put`
and closes the panel in one React batch, so the row shows the new name as
soon as the answer lands. The test's `until(focus === 'Rename')` gives up
quietly after its default 5 s (`harness.ts` `until` asserts nothing), so a
PATCH answered later under a full gate fell through to a one-shot read of the
old name.

- Reproduced with a scratch copy that delays only the PATCH *answer* by 6 s
  (`route.fetch` → wait → `route.fulfill`): old form **0/5**, failing with the
  reported `Input: 'codex on Linux'`; new form **5/5**. Plain 16-way parallel
  (48 runs) and a 20x CDP CPU throttle (5 runs) did not reproduce it, which
  fits answer latency rather than render order.
- Fix: `until` on the row name with the row's own 20 s budget, then assert
  the name, then assert focus is on *Rename* (focus was only waited for
  before, never asserted).
- Whole file 24/24 at 8-way parallel (20 tests a run).
- The task file arrived on this branch by add, not move: it lives in
  `.tasks/backlog/` only on `LAI-577-agent-field-withdraw-race`. Whoever
  merges second deletes that backlog copy (§2).

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #124.
