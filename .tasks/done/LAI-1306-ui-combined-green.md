---
id: LAI-1306
title: 'Make PR #350 (the combined UI transformation) green against master, then merge it'
area: web
assignee: chief
priority: p1
depends-on: []
status: done
accepted: 2026-11-17T13:48:17Z
started: 2026-11-17T09:40:00Z
finished: 2026-11-17T10:45:00Z
---

## Goal

Owner, 2026-11-17: "merge this in laika main repo in master as well as in the ksage laika branch
right now, its on you". PR #350 (`integration-ui-combined`, YashraajM: 34 UI PRs and 16 unpushed
branches, 908 files) is mergeable but its gate is red — 15 browser tests in web shards 1, 3 and 4
(shard 2 pending at filing). A red gate on master blocks every deploy after it (D-073), so the PR
is made green on this branch, built on its head without touching the author's branch, and this
branch is merged; GitHub then shows #350 as merged.

## Acceptance criteria

- [x] Every failing test classified: a regression of an accepted decision (fix the code — master's
      tests encode LAI-727, D-149 and the rest) or an intended UI change the PR's own task files
      describe (update the test, quoting that task).
- [x] The full CI gate green on this branch's PR (test, lint, format each exit 0).
- [ ] Merged into master; the CI / Deploy run on master green; AWS health shows the merge SHA.

## Notes / context

Failing at filing (PR run 44052931120): shard 1 — "people present: no row, and the header still
counts the agents" (Board has no WORKING NOW row, LAI-727), "a link applied via Apply stays in the
description; nothing navigates" (link popover inside the dialog), "Availability at 390: nothing
sideways, no CSP violation" (on a phone, and under the policy), "Retry asks again, and a good answer
replaces the error" (Meeting review on the kit), four "not due, half a day, requested" frames
(holidays and leave, D-149 item 6); shard 3 — "on leave in the HR system at 390 … the pill says it
over Open" (My availability on My day), "sort, search and the list view survive a reload" (Spaces:
the page is its URL, LAI-1196); shard 4 — "/board" and "/list: no sprint strip and no WORKING NOW"
(LAI-727), "1024px/920px, sidebar open: … land without a shift", "one stream for the space, not one
per consumer" (the space bar).

## Builder notes (LAI-1306, 2026-11-17)

PR #351 (`LAI-1306-ui-combined-green`) carries #350's head 9c4fda337 plus
eleven commits; CI run 44065979691 on b7a991634 is green in every gate job.
Verdict per failure is in the PR body and the log. Two product fixes
(`api/event-stream.ts`: a late subscriber hears `open`/`ready`; My day's
phone bar keeps *On leave* whole, D-149 item 5), the rest tests made stale
by this PR's own tasks (LAI-1214, LAI-1219, LAI-1227, LAI-1233), fixtures
older than LAI-1185's `on_leave`, and one test leak that hung web shard 2
for 60 minutes. The merge criterion stays open for CHIEF.
