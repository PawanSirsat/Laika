---
id: LAI-307
title: 'task-markdown "clicking the rendered text opens the raw markdown; a link does not" times out waiting for the link popup in a root gate'
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-857
status: backlog
---

## Goal

`server/web/test/browser/task-markdown.test.ts:226` does not fail a root gate
while the link it clicks opens its page. Keep the assertion that a link click
does not open the editor.

## Acceptance criteria

- [ ] Find out, with evidence, why no `page` event arrived within 5000ms: the
      click missed the link, the link did not open a page, or the page opened
      late. Do not infer it from the durations alone.
- [ ] Fix the cause you found. Do not add a suite retry or a sleep, and do
      not raise the timeout without a measured reason.
- [ ] The file passes alone, and in a root gate. `pnpm test`, `pnpm lint` and
      `pnpm format` each exit 0.

## Evidence

Failed LAI-857's root gate on Strelka (branch
`LAI-857-card-click-first-card-wait`, HEAD `92e2da81`, recorded in
`logs/strelka-2026-10-21.md`). The 1-minute load was 21.07 when the gate started and 45.81 when
`pnpm test` ended. Verbatim:

```text
not ok 3 - clicking the rendered text opens the raw markdown; a link does not
  duration_ms: 5413.749708
  location: '…/server/web/test/browser/task-markdown.test.ts:226:8'
  error: 'browserContext.waitForEvent: Timeout 5000ms exceeded while waiting for event "page"'
  stack: TestContext.<anonymous> (…/task-markdown.test.ts:233:38)
```

Web reported 2690 cases with 2689 passing. pnpm then bailed, so the server
suite did not finish. The file passed alone straight after, at a load of
24.52: `node --test test/browser/task-markdown.test.ts` (in `server/web`),
exit 0, 4 cases, 4 passed. LAI-715 (PR #12) does not touch this file.
