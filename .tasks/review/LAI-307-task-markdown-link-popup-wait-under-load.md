---
id: LAI-307
title: 'task-markdown "clicking the rendered text opens the raw markdown; a link does not" times out waiting for the link popup in a root gate'
area: web
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-857
status: review
started: 2026-10-22T06:24:02Z
finished: 2026-10-22T06:45:37Z
---

## Goal

`server/web/test/browser/task-markdown.test.ts:226` does not fail a root gate
while the link it clicks opens its page. Keep the assertion that a link click
does not open the editor.

## Acceptance criteria

- [x] Find out, with evidence, why no `page` event arrived within 5000ms: the
      click missed the link, the link did not open a page, or the page opened
      late. Do not infer it from the durations alone.
- [x] Fix the cause you found. Do not add a suite retry or a sleep, and do
      not raise the timeout without a measured reason.
- [x] The file passes alone, and in a root gate. `pnpm test`, `pnpm lint` and
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

## Result (strelka, 2026-10-22)

**Cause: the page opened late, and the wait was on the internet.** The link is
`https://example.com/repo`, a real address, and Playwright fires a popup's
`page` event only once the popup's first navigation has a response. Measured
with a probe that timestamps the click, the popup's response and the event,
against this file's fixture:

| upstream | click resolves | response | `page` event |
| --- | --- | --- | --- |
| real example.com (answers 404) | 183ms | 273ms | 275ms |
| held 6000ms by a route | 183ms | 6186ms | 6188ms |
| fulfilled locally | 178ms | 179ms | 205ms |

The click hits the link (the popup's request leaves as the click resolves, in
every row), and the link opens a page. Only the arrival of the event moves,
with the upstream. The gate's own run left nothing but the timeout, so which
part of that round trip was slow on Strelka (DNS, the remote, or the loaded
browser's network service) is not known. The test no longer depends on it.

**Fix** (`server/web/test/browser/task-markdown.test.ts`): the context answers
`https://example.com/**` with a local page before the click, and the test
asserts the popup opened `https://example.com/repo`. Timeout unchanged at
5000ms, no retry, no sleep; the editor assertion is unchanged.

**Broken once:** the route held its answer 6000ms → `not ok 3`, `browserContext.waitForEvent:
Timeout 5000ms exceeded while waiting for event "page"`, the gate's error verbatim.
Restored, checksum back to the fixed file's.

**Gate** on `a4199bb5`, under `/tmp/laika-root-gate.lock`:
- run 1 (load 18–29): TEST 1, LINT 0, FMT 0. Web 2763/2763 incl. this test;
  server failed only `test/services/sprints.test.ts:623` (5000ms timeout) =
  LAI-304. That file alone: exit 0, 43/43.
- run 2 (load 37–57): TEST 0, LINT 0, FMT 0. Web 2763/2763, server 3411 passed
  10 skipped, cli 0 failed.
