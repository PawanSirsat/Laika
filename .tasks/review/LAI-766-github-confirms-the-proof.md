---
id: LAI-766
title: 'Review gate, step 2: GitHub confirms the proof an agent attaches on finish (server/ + server/web/ + docs/)'
area: server
assignee: chief
priority: p1
depends-on: [LAI-758, LAI-753]
discovered-from: LAI-758
started: 2026-10-17T09:28:56Z
status: review
finished: 2026-10-17T11:02:53Z
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

- [x] GitHub events flip evidence items, newest event wins, with **no change
      to `task_evidence`'s columns** (§4.26 already has `state`,
      `state_source`, `state_at`); new tables only for what GitHub reported.
- [x] A **commit** item is `confirmed` when a `push` (any branch) or a
      `pull_request` carries that sha — full, or an unambiguous prefix of at
      least 7 characters — in a repository the task's project could plausibly
      use, and is never matched across repositories when the evidence names
      one.
- [x] A **pull request** item is `confirmed` when a `pull_request` event for
      that pull request is seen (opened, synchronize, closed/merged), and the
      proof shows whether it was merged.
- [x] **Test** items take their state from CI for the round's head commit
      (the pull request's head sha, else the newest claimed commit):
      `check_suite`, `check_run` and `workflow_run` results. All passed →
      `confirmed`; any failure, timeout or cancellation → `failed`; anything
      still pending → `claimed`. The CI result is shown as its own line
      beside the claimed commands (*CI: 3 of 3 checks passed*, *CI: lint
      failed*).
- [x] Events that arrive **before** the finish still count: a bounded record
      (30 days) of the shas, pull requests and check results seen, evaluated
      when a finish arrives.
- [x] The task panel's Proof section and the Review page show claimed (grey),
      confirmed (green) and failed (red) with the CI line; the Review page's
      filters gain *CI failed* and *CI confirmed*; `get_task_context` returns
      the states and the CI line.
- [x] A merged pull request still moves its linked task to review and never
      to done (D-082).
- [x] No outbound call to GitHub (§13.4): everything comes from deliveries.
- [x] SPEC updated and a decision record appended (next free D number).
- [x] Tests: signed fixture deliveries (HMAC sha256 with a test secret) for
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

Made with LAI-753 on one branch; the decision record is **D-083**.

**What was built**

- `server/src/services/github-proof.ts` (new) — records what GitHub said and
  checks rounds against it: `recordCommits`, `recordPullRequest`,
  `recordCheck`, `pruneGithubRecords` (30 days, run on each delivery),
  `confirmRound`, `reconcileProof`, `roundSummaries`, `ciLine`.
- Migration `0034_github_confirm.sql` — **four CREATE TABLEs, nothing
  altered**: `github_commits`, `github_pull_requests`, `github_checks` (the
  30-day record) and `task_round_github` (one row per round, so the proof
  still reads the same once the record has expired). `task_evidence` is
  unchanged. SPEC §4.28–§4.31.
- `server/src/services/webhooks.ts` — `push` and `pull_request` record what
  they carry and re-check the rounds they touch; `handleCheck` for
  `check_run`, `workflow_run` and `check_suite`; a merged pull request on a
  task already in review answers `200` instead of `409`.
- `server/src/services/rounds.ts` — every finish is checked against what
  GitHub already said; round views carry `pull_request.merged` and `ci`.
- `server/src/mcp/read-tools.ts` — `get_task_context`'s proof shows each
  item's state, *merged*, and the CI line.
- Web: `EvidenceSection.tsx` / `evidence.css` (claimed grey, confirmed green,
  failed red, *merged* / *not merged*, the CI line), `ReviewScreen.tsx` /
  `review.css` (*CI failed* and *CI confirmed* filters, a CI chip per row, an
  open proof re-reads when GitHub changes an item), `api/review.ts`.

**Decisions taken while building** (the simplest reasonable option where the
brief was open)

- **A `pull_request` delivery names only its head commit**, not the list of
  its commits. The other commits reach Laika through the `push` GitHub sends
  for the branch, which is recorded on any branch — so "a pull request's
  commits contain that sha" is met by the push plus the head.
- **"All required runs" is every run GitHub reported for the head commit.**
  Which checks are *required* lives in branch protection, which no delivery
  carries, and fetching it would be an outbound call (§13.4).
- **CI counts one kind**: check runs if any, else workflow runs, else check
  suites. A GitHub Actions run reports itself as all three; summing them would
  read one job as three.
- **The head commit for CI** is the pull request's head when GitHub named it,
  else the newest claimed commit GitHub reported (commit time; on a tie, the
  first listed), else the first listed.
- **Plausible repositories**: the project's `repo` when it names one, and
  only that; the pull request URL's repository only when the project names
  none; else any repository this org's webhook reports. (Changed in review:
  B1 below.)
- **The branch item is confirmed too** (D-082 made it an item): by a push to
  it or a pull request from it.
- **Newest event wins** by GitHub's own timestamp on the pull request and on
  each check (`updated_at` / `completed_at`), so a late manual redelivery of
  an old failure cannot undo a passing re-run. Commit, branch and pull request
  items only go `claimed → confirmed`; test items follow CI both ways and
  return to `claimed` while a re-run is pending.
- **Neutral and skipped pass; `stale` is pending**; failure, timed out,
  cancelled, action required and startup failure fail.
- **No live push of a confirmation**: a state GitHub flips moves no task, so
  the board's stream does not carry it. The panel reads it when opened, the
  Review page on its 20-second re-read (`proofStamp` in the proof's refresh
  key). Recorded in D-083.
- **`claimed` is grey now** (it was blue), as the brief asked.

**Did not fit / left alone**

- ~~A `pull_request` **opened** after the agent finished still moves the
  task back to `in_progress`.~~ Fixed in review: see below.
- LAIKA-477's card also names GitHub's legacy commit `status` event; the
  brief listed `check_suite`, `check_run` and `workflow_run`, so `status` is
  not handled.
- Out of scope as briefed: replay protection beyond the 24 h window, HTTPS
  and hardening, Gitea/GitLab, LAI-764, `capacity.test.ts`.

**Verified**

- `server/test/http/routes/github-proof.test.ts` — signed fixture deliveries
  (HMAC-SHA256 with the secret the API handed out) for `push`,
  `pull_request`, `check_run`, `workflow_run` and `check_suite`: events before
  and after the finish, a 7-character prefix, an ambiguous prefix, another
  repository (commits and CI), the pull request's own repository, a failing
  check, a pending check, newest-event-wins with a late redelivery, a bad
  signature (`401`, nothing recorded), a cleared secret (`401`), and a merge
  that moves to review and never to done.
- `server/test/services/github-proof.test.ts` — the pull request key, GitHub's
  conclusions, the readers, and the 30-day record.
- `server/web/test/browser/github-confirm.test.ts` — *the proof GitHub
  confirmed (D-083)*: the CI filters, each row's CI chip, and the three states
  with their computed colours in both themes, the CI line and *merged*.
- `server/web/test/api/review.test.ts` — the CI filters, `ciVerdict`,
  `ciLine`, `proofStamp`.
- 39 mutations across both tasks, each turning its named tests red, the tree
  restored and hash-checked after each: the log has the list.
- Screenshots (light and dark, 1366 and 390):
  `/tmp/laika-github-confirm-shots/` — `organisation-webhook-*`,
  `proof-states-*`, `review-queue-*`, `review-ci-failed-filter-*`.

## Review round 1 — CHANGES REQUIRED, fixed (2026-10-17)

The orchestrator's review found two blockers in
`server/src/services/github-proof.ts` and asked for two small fixes beside
them; security, migration 0034 and retention were confirmed sound. All four
are fixed on this branch with **no new migration**, each with a test in
`server/test/http/routes/github-proof.test.ts` (*the review's fixes (D-083)*)
that was written first and run red against the unfixed code, then green.

- **B1 — a pull request in another repository chose who vouched.**
  `plausibleRepos` preferred the pull request URL's repository over the
  project's, so an agent citing `someone/else/pull/5` on a `kvell/laika`
  project had its commit and tests confirmed by `someone/else`'s push and
  check. Now the project's `repo` wins and is the only one; a pull request
  elsewhere is not looked up, confirms nothing, and supplies no head. The
  pull request's repository narrows only when the project names none.
  Before: `expected 'confirmed' to be 'claimed'`. After: commit, pull request
  and tests `claimed`, `ci` null.
- **B2 — a later round rewrote an earlier one.** `roundsTouched` re-checked
  every round naming the commit or pull request, so round 1 on pull request
  #42 took round 2's head and CI. Now only an **open** round is re-checked:
  the newest of its task, with no `task_reviews` row against it. Before
  (both directions): round 1's `ci.head_sha` was head B and its tests
  followed B's CI. After: round 1 keeps head A and its own states.
- **`opened` / `reopened` only start work** — they move a task out of
  `backlog` or `todo` and nothing else; anything else answers `200` and
  stays. Before: a late `opened` moved a review task to `in_progress`;
  `reopened` moved a done task to `in_progress`. After: both stay.
- **A merge on a done task answers `200`** and leaves it done. Before:
  `422 Cannot move a task from Done to Review`.

D-083 items 3, 6 and 8 and SPEC §4.31 and §10.1 say the new rules; D-083's
*does not decide* no longer lists the `opened` case.

Left as follow-ups, as the review asked: same-name check runs or suites
overwriting each other, a non-JSON signed body answering 500, the 1 MiB body
limit, and the legacy `status` event.
