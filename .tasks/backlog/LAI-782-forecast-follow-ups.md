---
id: LAI-782
title: 'Size and forecasts, phase 2 follow-ups: sprint line on a phone, rework queries chunked, one estimate read in the panel, names in send-back reasons, rework from the send-back'
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-772]
discovered-from: LAI-772
status: backlog
---

## Goal

The LAI-772 review (round 1) found five things it did not hold the task for
and the orchestrator did not ask the builder to fix in that round. Each is
small. N3 and N5 are in `server/web/`; N4, N6 and N8 are in `server/src/`.

The reviewer's items, as quoted to the builder:

- **N3:** "the 390 px sprint screenshots don't show the forecast line; the row
  has no phone breakpoint."
- **N4:** "reworkCost's `inArray` at token-usage.ts:789/836 isn't chunked by
  500, and it scans every round per send-back." (Lines as of 9884e725; after
  the master merge c38064d0 they are `server/src/services/token-usage.ts:806`
  and `:853`. `:791` and `:872` take the project ids and are bounded by the
  projects a reader may read.)
- **N5:** "TokensSection fetches /tasks/:id/estimate again after
  ForecastSection already has."
- **N6:** "send-back reasons in similar tasks are passed through as written and
  may contain names."
- **N8:** "rework counts from the round's finish, so time waiting in review is
  included."

## Acceptance criteria

- [ ] N3: at 390 px the Sprints page shows a sprint's forecast line without
  sideways scroll, light and dark; a browser test reads it at that width.
- [ ] N4: `reworkCost`'s task-id `IN` lists are chunked by 500, and the next
  finish after each send-back is found without a pass over every round per
  send-back; a test counts the statements or rows (no wall-clock assertion,
  LAI-779) on a range with more than 500 sent-back tasks.
- [ ] N5: the task panel reads `GET /tasks/:id/estimate` once per task and
  refresh, shared by the Forecast and Tokens sections; a browser test counts
  the calls.
- [ ] N6: decide, and write down, what `get_task_context`'s `similar[].send_backs`
  does with a reason that names a person (D-078) — for example, replace the
  names of the project's members — with a test for the decision.
- [ ] N8: the Usage page's rework **tokens** start at the send-back, not on the
  days after the sent-back round's finish, so tokens on days the task waited
  in review are not counted as rework (SPEC §6.4's `rework`); a test with a
  review wait spanning days shows it. Rework **time** already starts at the
  send-back and stays so.
- [ ] Root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Notes / context

- Discovered in the LAI-772 review, round 1; B1, N1, N2 and N7 were fixed in
  that round. N3–N6 and N8 were deferred here on the orchestrator's word.
- N8, read on c38064d0: `reworkCost`'s time is `next finish − send-back`
  (`token-usage.ts:832`); its token boundary is the sent-back round's finish
  day (`:836`), which is the part the reviewer's item applies to. The task
  panel's rework time (`actualTimes` in `estimates.ts`) also starts at the
  send-back.
- No new dependency.
