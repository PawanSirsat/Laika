---
id: LAI-766
title: 'Review gate, step 2: GitHub confirms the proof an agent attaches on finish (server/ + server/web/ + docs/)'
area: server
assignee: chief
priority: p1
depends-on: [LAI-758, LAI-753]
discovered-from: LAI-758
started: 2026-10-17T09:28:56Z
status: in-progress
---

## Goal

**Made on the owner's direct instruction** (Pawan Sirsat, 2026-10-17, through
the orchestrator), single-agent mode, on the temporary branch
`build-github-confirm` cut from `master` `c511c602`, worktree
`Laika-github-confirm`, together with LAI-753 (the webhook has to be usable
before it can confirm anything). Board card **LAIKA-477**. One branch changes
`server/`, `server/web/` and `docs/` together. Not pushed, not merged: the
orchestrator reviews and merges.

LAI-758 (D-082) stores every finish as a round whose evidence items are all
`claimed`: the agent said so and nothing checked. This task lets GitHub's own
webhook deliveries check them, so a reviewer can tell a claim from a fact
without leaving the Review page — and without Laika ever calling GitHub
(SPEC §13.4).

## Acceptance criteria

- [ ] GitHub events flip evidence items, newest event wins, with **no change
      to `task_evidence`'s columns** (§4.26 already has `state`,
      `state_source`, `state_at`); new tables only for what GitHub reported.
- [ ] A **commit** item is `confirmed` when a `push` (any branch) or a
      `pull_request` carries that sha — full, or an unambiguous prefix of at
      least 7 characters — in a repository the task's project could plausibly
      use, and is never matched across repositories when the evidence names
      one.
- [ ] A **pull request** item is `confirmed` when a `pull_request` event for
      that pull request is seen (opened, synchronize, closed/merged), and the
      proof shows whether it was merged.
- [ ] **Test** items take their state from CI for the round's head commit
      (the pull request's head sha, else the newest claimed commit):
      `check_suite`, `check_run` and `workflow_run` results. All passed →
      `confirmed`; any failure, timeout or cancellation → `failed`; anything
      still pending → `claimed`. The CI result is shown as its own line
      beside the claimed commands (*CI: 3 of 3 checks passed*, *CI: lint
      failed*).
- [ ] Events that arrive **before** the finish still count: a bounded record
      (30 days) of the shas, pull requests and check results seen, evaluated
      when a finish arrives.
- [ ] The task panel's Proof section and the Review page show claimed (grey),
      confirmed (green) and failed (red) with the CI line; the Review page's
      filters gain *CI failed* and *CI confirmed*; `get_task_context` returns
      the states and the CI line.
- [ ] A merged pull request still moves its linked task to review and never
      to done (D-082).
- [ ] No outbound call to GitHub (§13.4): everything comes from deliveries.
- [ ] SPEC updated and a decision record appended (next free D number).
- [ ] Tests: signed fixture deliveries (HMAC sha256 with a test secret) for
      `push`, `pull_request`, `check_suite`, `check_run` and `workflow_run`,
      including events before and after the finish, a failing CI, an unknown
      repository, a bad signature (401) and a missing secret; each new test
      fails without its fix (shown by reverting once). A browser test for the
      settings section (set, copy once, rotate) and for the Proof states.

## Out of scope

Security hardening and HTTPS (parked by the owner), delivery-id replay
protection, Gitea/GitLab, the LAI-764 follow-ups, and
`server/web/test/browser/capacity.test.ts` (another builder, branch
`fix-capacity-flake`).

## Notes / decisions taken while building

Filled in as the work lands; the decision record is D-083.
