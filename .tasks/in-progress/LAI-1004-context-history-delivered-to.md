---
id: LAI-1004
title: 'Context History shows "Delivered to": the sessions a revision reached, by agent label and time'
area: web
assignee: shell
priority: p2
depends-on: [LAI-1003, LAI-556]
discovered-from: LAI-556
status: in-progress
started: 2026-10-30T17:20:00+05:30
---

Web half of *Delivered to*; the server half is LAI-1003. Board: child of
LAIKA-785 (Sprint 10, `phase-4`, `host-belka`).

## Outcome

On the project context History (LAI-556), each revision shows **Delivered
to**: the agent sessions that revision reached, each as its agent label
(`<harness> · <device>`, D-120) and when it was delivered. A person can answer
"has Omnigent · Belka been given the brief I just changed?" without asking.

## Scope

- Read LAI-1003's endpoint for the revision being viewed; no other source.
- A **Delivered to** list in the revision's History entry: label, relative
  time with the absolute time on hover/focus, newest first.
- **Wording says what the server knows.** It is *delivered*, never *read* or
  *seen*, and it is the session's **latest** delivery (LAI-1003): the heading
  or a one-line note says a session given a later revision moves to that one.
- Empty state: *Not delivered to any agent session yet.* Loading and error
  states as the History screen's others.
- Labels come from the one label function LAI-1001 introduces if it has
  landed; otherwise from the label the endpoint returns. Never a free-text
  agent name.
- A client type for the response, paired in `response-type-coverage.test.ts`
  (no new `UNPAIRED` entry).

## Acceptance criteria

- [ ] A revision delivered to two sessions lists both, with label and time,
      newest first; one delivered to none shows the empty state
- [ ] The wording says *delivered*, and says a session moves to the revision
      it was last given
- [ ] The list re-reads when the History's revision changes; no stale list
      from the previous revision is shown (crossing reads tested, as the web
      client shares in-flight GETs)
- [ ] Both themes, 390 px and desktop, keyboard reachable
- [ ] Mutation-checked; the repo gate (`pnpm test`, `pnpm lint`,
      `pnpm format`) exits 0
