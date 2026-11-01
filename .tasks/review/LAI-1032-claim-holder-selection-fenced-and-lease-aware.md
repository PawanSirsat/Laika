---
id: LAI-1032
title: 'Selecting the claim holder stays fenced, and counts a claim only while its lease holds'
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-1027
status: review
started: 2026-11-01T16:06:12Z
finished: 2026-11-01T16:16:54Z
---

Owner batch, 2026-11-01 (polly dispatch): the non-blocking notes from the
#181 (LAI-1027) review, one PR.

## Goal

1. **The D-path is still fenced.** Selecting the agent that already holds
   the live claim is allowed (LAI-1027), but the holder's own token making
   that change goes through the claim fence like any other change: no claim
   generation or a stale one is refused, and only the current one succeeds.
2. **A lapsed lease is not a claim, here either.** `liveClaim`
   (`server/src/services/claims.ts`) returns an `active` claim whose lease has
   run out until the scan expires it; the task view (`liveClaimViews`) already
   leaves those out through `leaseLapsed`. The selection rule
   (`assertSelectionChangeAllowed`, `moveSelection` in
   `server/src/services/work-requests.ts`) uses the same check, through one
   shared helper.
3. **Re-selecting a pre-D-119 holder.** The owner selecting the agent that
   holds a claim the selection does not back makes that claim usable again,
   at its current generation.

Named cross-area edit: SPEC §6.4's `selected_agent_id` / `claim_held`
paragraph (the one LAI-1027 edited) — two sentences, for items 2 and 3.

## Acceptance criteria

- [x] The holder's own token selecting itself: no generation → `409`
      `stale_claim`; a stale generation → `409` `stale_claim`; the current
      one succeeds, and the claim is untouched.
- [x] One helper decides "a claim in force" for the task view and the
      selection rule, built on `leaseLapsed`; a clock test at 1 ms before and
      1 ms after the lease ends shows the selection rule and the task view
      agreeing at both instants.
- [x] Owner re-selects a pre-D-119 holder → the holder's change at its
      current generation succeeds, and the generation is unchanged.
- [x] SPEC §6.4 says items 2 and 3.
- [x] Each new test mutation-checked: the behaviour broken once, the test red.
- [ ] CI green on the PR.
