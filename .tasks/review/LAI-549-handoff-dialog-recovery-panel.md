---
id: LAI-549
title: 'Hand-off dialog + drawer recovery panel (checkpoint age, note staleness, approval)'
area: web
assignee: shell
priority: p1
depends-on: [LAI-546, LAI-543]
discovered-from:
started: 2026-10-30T00:55:00Z
status: review
finished: 2026-10-29T21:00:00Z
---

Implements **proposal §6 (hand-off dialog, drawer)** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

A human starts or approves a hand-off from the task drawer and sees
the last verified checkpoint, its age, whether the note is stale, and whether
recovery is available — and the sender never sees "accepted" on the
receiver's behalf.

## Scope

- Hand-off dialog with `useDialogFocus`: from → to, reason, checkpoint summary and age, note, approval needed, "The receiver must accept".
- Drawer recovery panel: last verified checkpoint, "Note describes an earlier save", "No continuation note", "Automatic recovery unavailable — no saved checkpoint" with reassign / release actions.
- Client mirror of `checkpoint_saved` and the seven hand-off verbs with wording.

## Out of scope

- Inbox (LAI-550)

## Acceptance criteria

- [x] The dialog traps focus, closes on Escape and returns focus (asserted).
- [x] The sender's view shows "Waiting for … to accept" until the server reports acceptance (e2e).
- [x] All three checkpoint messages render from API fields (fixtures per case).
- [x] All eight verbs are mirrored; drift check green against LAI-545 and LAI-546.
- [x] Both themes, keyboard, 390 px.
- [ ] Repo-root gate exits 0.
- [x] The drawer shows "Verification pending" for a pending checkpoint and, after 10 minutes, "Verification pending — no push notice from GitHub yet" with the webhook / Redeliver hint for owners and admins; a newer pending checkpoint is shown beside the latest verified one as unverified.

## Tests and UI evidence required

Vitest; Playwright e2e offer → approve; screenshots light/dark/narrow.

## Dependencies

`depends-on: [LAI-546, LAI-543]`.

Client-mirror owner for `checkpoint_saved` (with LAI-544, LAI-545) and for `handoff_offered`, `handoff_approved`, `handoff_accepted`, `handoff_declined`, `handoff_cancelled`, `handoff_expired`, `task_recovered` (with LAI-544, LAI-546).

Related existing card: **LAIKA-533** (hand-off button).

## Role / machine

SHELL on Belka. Owner area: `web` (SHELL).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

2–3 days, confidence M.

## Branch

`LAI-549-handoff-dialog`

## Migration / rollout notes

Completes the three-owner merges for the eight Phase 3 verbs.

## Submission (2026-10-29, shell on Belka, dispatched by polly)

Branch `LAI-549-handoff-ui`, draft PR #150 into `LAI-546-handoff-offers`,
merged up to `f09a1680`. Started on the orchestrator's direction against
LAI-546 while it sat in review (its depends-on is not in `done/`), the same
deviation LAI-546 recorded against LAI-545.

**CI** (`gh workflow run deploy.yml --ref LAI-549-handoff-ui`, run
40946407827 on `74e7524d`): Lint success, Format success, Test failure.
`server/web` 3698 test cases, 3698 passed, 0 failed. `cli` 647 collected,
634 passed, 13 skipped, 0 failed. `server` 4460 collected, 4448 passed, 10
skipped, **2 failed — CORE's, verbatim**:

- `server/test/tooling/response-type-coverage.test.ts` › *every served
  response type is paired or named* › *names nothing that is already paired
  or no longer served* — `CheckpointRefView is paired now — remove it from
  UNPAIRED`, `CheckpointView is paired now — …`, `HandoffOfferView is paired
  now — …`; and › *reports how much of the surface is actually guarded* —
  `expected 116 to be 113`. LAI-546's own comment on those entries says
  "LAI-549 and LAI-550 mirror them": the exemption expired as designed. It
  lives in CORE's file, so it is not edited here (§4.4 step 2); dropping the
  three lines turns both green.

So the gate criterion is **not** ticked. Every web and cli red quoted by
LAI-545 and LAI-546 is green, plus `structure.test.ts`'s WEB_* mirror check.

**Where this differs from the task file**
- A person cannot *start* a hand-off: SPEC §3.2 / §4.71 make offering,
  accepting and declining a registered agent's acts (`403 not_an_agent`).
  The drawer's control reviews the live offer, and a person approves or
  withdraws it. The gallery's sender-side `HandoffDialog` is unchanged.
- "Sender's view … (e2e)" is a Playwright run against the built SPA with a
  stubbed API (`test/browser/handoff-drawer.test.ts`), not a live server:
  approve → *Waiting for … to accept* → *Accepted* only after the server's
  `task.handoff_accepted` and re-read; the browser's only POST is `approve`.
- Card states *Recovery available* / *Save needs attention* are drawer-only:
  the task list carries no checkpoint or offer field.
- Wording for every §6.3 hand-off reason (`HANDOFF_REASON_WORDS`), held to
  §6.3's table by a test that reads the SPEC.

**Not filed (CHIEF's block is full)**
- The owner's checkpoint-consent toggle (`PUT/DELETE
  /agents/:id/checkpoint-consent`) has no screen or task.
- Card-level recovery/attention states need CORE to serve checkpoint/offer
  state on the task list.

**Local, each file alone** (owner resource rules): `handoff-derive.test.ts`
23/23, `handoffs.test.ts` 7/7, `handoff-drawer.test.ts` (browser) 5/5,
`endpoint-coverage`, `view-type-drift` (mutation-checked), `use-events`,
`activity-labels`, `dashboard-derive`, `cli/test/plugin-mcp.test.ts`,
`server/test/tooling/structure.test.ts` — all exit 0. Web typecheck 0;
prettier and eslint on every changed code file 0. Screenshots light/dark ×
1440/390 in `.polly/evidence/LAI-549/` on Belka.

### Named crossing authorised by CHIEF (2026-10-29)

CHIEF authorised one named cross-area edit (CLAUDE.md §1, D-033/D-034):
`server/test/tooling/response-type-coverage.test.ts` — exactly the three
`UNPAIRED` entries `CheckpointView`, `CheckpointRefView` and
`HandoffOfferView` removed, nothing else changed. This retires the two server
reds quoted above. `pnpm exec vitest run test/tooling/response-type-coverage.test.ts`:
exit 0, 10 passed.
