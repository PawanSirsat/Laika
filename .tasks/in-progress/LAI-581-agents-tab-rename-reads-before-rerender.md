---
id: LAI-581
title: 'web: agents-tab rename test reads the row name before the list re-renders, and fails under load'
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-577
started: 2026-10-28T20:59:02Z
status: in-progress
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

- [ ] The assertion waits on the settled row name (an `until` on the name, not
      on focus), without weakening what it proves.
- [ ] Decide with evidence whether the product shows the new name once the
      PATCH is confirmed (test timing) or can stay stale (product), and fix
      whichever it is.
- [ ] The file is green 20+ runs, including under parallel load.
- [ ] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Role / machine

SHELL on Belka. Owner area: `web` (SHELL).
