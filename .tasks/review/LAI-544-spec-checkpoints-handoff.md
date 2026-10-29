---
id: LAI-544
title: 'SPEC + decisions: checkpoints, hand-off offers, approvals, policy, MCP tools agent_sync/checkpoint_task/offer_handoff/respond_handoff'
area: docs
assignee: chief
priority: p1
depends-on: [LAI-540]
discovered-from:
started: 2026-10-29T13:42:55Z
status: review
finished: 2026-10-29T14:02:24Z
---

Implements **proposal §4.3, §4.4, §4.5** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

SPEC defines checkpoints, hand-off offers, approvals, the project
hand-off policy, the new verbs and the four new MCP tools, citing D-115 and
D-116, so CORE, SHELL and the helper build against one text.

## Scope

- SPEC §4: `task_checkpoints`, `handoff_offers`, `project_handoff_policies`; `tasks.handoff_count`.
- SPEC §10.1: a checkpoint is verified only by a signed push delivery for the configured repo; `ref_deleted`; delivery retention 90 days for referenced rows.
- SPEC §3.2: rows for offer, approve, accept, decline, cancel and for editing the policy; §3.4: the system actor creates recovery offers.
- SPEC §6.3 codes `offer_taken`, `claim_paused`; §6.4 endpoints; §7.1 tools `agent_sync`, `checkpoint_task`, `offer_handoff`, `respond_handoff`.
- SPEC §4.8 rows: `checkpoint_saved`, `handoff_offered`, `handoff_approved`, `handoff_accepted`, `handoff_declined`, `handoff_cancelled`, `handoff_expired`, `task_recovered`.
- `docs/DECISIONS.md`: only if LAI-533 could not record D-115 / D-116.

## Out of scope

- Delivery states and context revisions (Phase 4).

## Acceptance criteria

- [ ] SPEC §4 columns match proposal §4.3 – §4.5 exactly. **Not met as written, on purpose:** every proposal column is there, but `task_checkpoints.verification` is D-116's `pending | verified | ref_deleted | uncertain` (the approved D-116 drops the proposal's `missing`), and `handoff_offers` adds `receiver_commit_sha` (D-116 item 8), `closed_reason` (proposal §4.2's `reclaimed`) and LAI-535's built `created_by_user_id`, `closed_at`; `project_handoff_policies` adds `id` and `updated_by`. D-116 also needs `checkpoint_refs` and `checkpoint_ref_transitions`, and D-115 item 2 `agent_checkpoint_consents`.
- [x] SPEC states a `pending` checkpoint can be neither offered nor accepted, and that the server never fetches a URL (D-083).
- [x] SPEC states the approver is the task's assignee or a project admin and never the receiver.
- [x] Each of the eight verbs has a §4.8 row naming its enum task and its client-mirror task.
- [x] SPEC §7.1 names the four new tools and `parity.test.ts` reports the names missing from the registry only (red, quoted, retired by LAI-545 / LAI-546).
- [ ] Repo-root gate exits 0 after the last edit, or red only as quoted above. **Not met:** `pnpm test` exits 1 with more reds than parity's — every one the spec ahead of the code, quoted under *Delivered*. `pnpm lint` 0, `pnpm format` 0.

## Tests and UI evidence required

Repo-root gate, three exit codes.

## Dependencies

`depends-on: [LAI-540]`.

Eight three-owner verbs (CLAUDE.md §4.4). `checkpoint_saved`: **LAI-544** (SPEC) · **LAI-545** (enum) · **LAI-549** (client mirror). `handoff_offered`, `handoff_approved`, `handoff_accepted`, `handoff_declined`, `handoff_cancelled`, `handoff_expired`, `task_recovered`: **LAI-544** (SPEC) · **LAI-546** (enum) · **LAI-549** (client mirror + wording; LAI-550 renders them in the Inbox).

## Role / machine

CHIEF (polly) on Belka. Owner area: `docs` (CHIEF).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

1–2 days, confidence M.

## Branch

`LAI-544-spec-checkpoints-handoff`

## Migration / rollout notes

Docs only.

## Delivered

Branch `LAI-544-phase3-spec` (worktree `.polly/wt-544`), base `46da1c03`.
Board LAIKA-796, claimed by session `01M63Y83PQBGJB19YM88W1V370`.

- `docs/DECISIONS.md`: D-114, D-115, D-116 (revised) copied verbatim from
  `docs/proposals/LAI-533-spec-and-decision-drafts.md`, only the status line
  changed: approved 2026-10-29, Pawan's comment on PR #99
  (<https://github.com/PawanSirsat/Laika/pull/99#issuecomment-6498255781>).
  D-117 – D-119 are not in `DECISIONS.md`; D-118 / D-119 live in
  `docs/proposals/LAI-532-agent-identity-model.md` (#121). Nothing renumbered.
- `docs/SPEC.md`: §3.2 seven rows; §3.4 four system actions; §4.5
  `handoff_count`; §4.8 eight verbs; §4.66 paused/transferred; §4.68 – §4.73
  new; §6.3 reasons and rate buckets; §6.4 endpoints and prose; §7.1 four
  tools, §7.2 `claim_generation`; §9.1.1 timings; §10.1 checkpoint tags;
  §11.6 two jobs. Also LAI-571's §6.4 `If-Match` / `ETag` / list `etag` text
  from PR #113, verbatim.

**Names for LAI-545 – LAI-549.**

- Tables: `task_checkpoints` (§4.68, Planned — LAI-545), `checkpoint_refs`
  (§4.69, LAI-545), `checkpoint_ref_transitions` (§4.70, LAI-545),
  `handoff_offers` (§4.71, built in part), `project_handoff_policies` (§4.72,
  Planned — LAI-546), `agent_checkpoint_consents` (§4.73, Planned — LAI-545);
  column `tasks.handoff_count`.
- Verbs: `task.checkpoint_saved` (LAI-545), `task.handoff_offered`,
  `task.handoff_approved`, `task.handoff_accepted`, `task.handoff_declined`,
  `task.handoff_cancelled`, `task.handoff_expired`, `task.recovered`
  (LAI-546); mirror LAI-549.
- Project actions: `task.checkpoint.create`, `task.handoff.offer`,
  `task.handoff.approve`, `task.handoff.accept`, `task.handoff.decline`,
  `task.handoff.cancel`, `project.handoff_policy.edit`. System:
  `system.handoff.recover`, `system.handoff.expire`, `system.checkpoint.verify`,
  `system.checkpoint.prune`.
- `details.reason`s (D-079, no new codes): `offer_taken`, `offer_closed`,
  `approval_pending`, `checkpoint_unverified`, `handoff_limit`, `offer_live`,
  `checkpoint_mismatch`, `repo_not_configured`, `checkpoint_required`,
  `receiver_not_eligible`, `approver_is_receiver`; `claim_paused` already
  existed.
- Tools: `agent_sync`, `checkpoint_task`, `offer_handoff`, `respond_handoff`.

**Gate, after the last SPEC edit** (`pnpm test` / `pnpm lint` / `pnpm format`
from the repo root): **TEST 1 · LINT 0 · FMT 0**. server 6 failed, 4276
passed, 10 skipped (4292); cli 1 failed, 664 passed, 2 skipped (667);
server/web 3663 passed, 0 failed. Every red is the spec ahead of the code:

1. `test/mcp/parity.test.ts` › *names exactly the registered tools* — missing
   `agent_sync`, `checkpoint_task`, `offer_handoff`, `respond_handoff`
   (LAI-545: `checkpoint_task`; LAI-546: the other three).
2. `cli/test/plugin-mcp.test.ts` › *the tool surface, from both sides* — the
   same four names.
3. `test/tooling/policy-spec-drift.test.ts` › *maps every §3.2 row to at least
   one action* — the seven new rows (LAI-545: *Save a checkpoint…*; LAI-546:
   the other six).
4. `test/tooling/schema-spec-drift.test.ts` › *has a column for everything §4
   specifies* — `tasks.handoff_count` and `handoff_offers.idempotency_key`,
   `from_session_id`, `checkpoint_id`, `reason`, `note_hash`,
   `requires_approval`, `approved_by_user_id`, `approved_at`, `expires_at`,
   `accepted_session_id`, `receiver_commit_sha`, `closed_reason` (LAI-546).
5. Same file › *allows every activity type §4.8 lists* — the eight verbs.
6. Same file › *drops a table exemption once §4 describes the table* —
   `"handoff_offers — exempted, but it is no longer an undocumented table;
   remove the entry"` (CORE's `TABLES_NOT_IN_SPEC`; LAI-546 or the first CORE
   branch that merges this).
7. Same file › *states nothing about a column the schema does not have* —
   `task_checkpoints.summary`, `.summary_commit_sha`, `.context_revision`,
   `.verified_at`; the eleven nullable `handoff_offers` columns above;
   `project_handoff_policies.updated_by`;
   `agent_checkpoint_consents.withdrawn_at`. **This one is a guard gap**: it
   does not skip a section marked *Planned*, though the table checks do.

**How it lands.** This cannot reach `master` green by itself, and no exemption
in CORE's files may be added from `docs/`. Recommended (§4.4): LAI-545 and
LAI-546 each `git merge LAI-544-phase3-spec` and turn their reds green, and
CHIEF merges this branch with them — the way LAI-540's SPEC rode on LAI-541.
Minimal alternative, if this must merge first: a task naming the crossing for
CORE's files — `ACTIVITY_TYPE_EXEMPTIONS` (8), `COLUMNS_NOT_IN_SCHEMA` (14),
dropping `TABLES_NOT_IN_SPEC.handoff_offers`, parity and plugin-mcp
exemptions for four tools — plus two guard changes: the policy guard has no
way to hold a §3.2 row whose action is not built yet (`ACTIONS_WITHOUT_A_ROW`
is the other direction), and the nullability check should skip Planned
sections as the table checks do.

**For CHIEF to act on.**

- LAI-545's task file predates D-116: it still says a *branch* at the SHA can
  verify, `superseded` is a state, and nothing about `uncertain`, re-tags or
  consent. §4.68 – §4.70 and §4.73 are now the text; its criteria want
  updating before it is claimed.
- D-115 item 2's consent had no owner task. §4.73 marks it *Planned — LAI-545*;
  CHIEF has no free id to file it separately (LAI-500 – LAI-599 are all used).
- LAI-571's SPEC criterion can now be ticked in review.
- `ACTIONS_WITHOUT_A_ROW` still holds `system.idempotency.prune`, waiting for a
  §3.4 row from CHIEF (LAI-534); not in this task's scope.

