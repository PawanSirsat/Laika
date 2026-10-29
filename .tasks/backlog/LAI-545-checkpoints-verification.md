---
id: LAI-545
title: 'Checkpoints: idempotent registration, verification from signed push deliveries only (D-083), ref_deleted, retention'
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-541, LAI-544]
discovered-from:
status: backlog
---

Implements **proposal §4.3, §4.3.1** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

An agent session registers a checkpoint for work it has pushed, and
Laika marks it `verified` only when a signed push delivery for the project's
configured repo contains that SHA on that ref — never by calling GitHub.

## Scope

**Revised 2026-10-29 by LAI-544 review round 1** (task still in backlog), to
match the approved D-116 and D-116a. The text to build against is SPEC §4.68 –
§4.70, §4.73, §6.4 *Checkpoints*, §10.1 and §11.6.

- Migrations: `task_checkpoints` (saved fields never change; only
  `verification` / `verified_at` move), `checkpoint_refs`,
  `checkpoint_ref_transitions` (keyed by `repo` + `ref`, unique
  `delivery_id`), `agent_checkpoint_consents`.
- `POST /tasks/:id/checkpoints` + `checkpoint_task` MCP tool, fenced by claim
  generation; `GET /tasks/:id/checkpoints`; `POST /checkpoints/:id/refs`
  (re-tag); `GET/PUT/DELETE /agents/:id/checkpoint-consent`.
- Actions `task.checkpoint.create`, `task.checkpoint.retag`;
  `system.checkpoint.verify`, `system.checkpoint.prune`.
- Verification **only** from signed `push` deliveries for a
  `refs/tags/laika-ckpt/…` ref in the project's configured repo
  (`422 repo_not_configured` otherwise). **A branch never verifies a
  checkpoint.**
- States `pending`, `verified`, `ref_deleted`, `uncertain`; the checkpoint's
  state is its newest ref's. `superseded` is derived on read, never stored.
- `checkpoint_saved` enum + CHECK.
- `pending_since` exposed (newest ref's `created_at` while pending) so the UI
  can show the 10-minute no-notice message.
- Retention per SPEC §4.68 / §11.6. Laika never deletes tags.

## Out of scope

- Offers (LAI-546)
- The helper (LAI-547)

## Acceptance criteria

- [ ] Registering twice with one key returns the same row and writes one `checkpoint_saved` (asserted).
- [ ] No code path makes an outbound HTTP request (asserted by a test that fails on any network call).
- [ ] The manifest names files and counts only; no file content, diff or prompt text is stored (asserted by schema and a test).
- [ ] A checkpoint with failing tests is valid and stores the status as given.
- [ ] Repo-root gate exits 0, or red only on the client mirror assertion quoted verbatim, retired by LAI-549.
- [ ] Without a matching signed delivery a checkpoint stays `pending`; one creation delivery putting the tag `laika-ckpt/<LAI-NNN>/<checkpoint-id>` at exactly the SHA makes it `verified`; a deletion of that tag makes it `ref_deleted`. **A delivery for the work branch at the same SHA changes nothing** (asserted). `superseded` is derived on read when a newer verified checkpoint exists on the same claim, and is never stored.
- [ ] Processing the same `X-GitHub-Delivery` twice changes the state once (asserted).
- [ ] **D-116a — the state is a function of the set, never of arrival order** (each asserted in both orders): {creation} → `verified`; {creation, deletion} → `ref_deleted`; {creation, deletion, deletion (second id)} → `ref_deleted`; {deletion} → `uncertain`; {creation, update} → `uncertain`. **No sequence returns a ref to `verified`** once its set holds a deletion or a foreign transition.
- [ ] A checkpoint is never `verified` on the agent's word: no API field or MCP argument can set it (asserted).
- [ ] A checkpoint in a repo other than the project's configured one is refused `422 repo_not_configured`.
- [ ] After 10 minutes (configurable, injected clock) still `pending`, the checkpoint read reports it so the UI shows "Verification pending — no push notice from GitHub yet".
- [ ] The service exposes the accept-time check LAI-546 calls: a differing `verified_commit_sha` is `422 checkpoint_mismatch`; a non-`verified` checkpoint is `409 checkpoint_unverified`.
- [ ] Retention (injected clock): checkpoints, their refs and those refs' transitions are kept 90 days after Done/Cancelled and then deleted; transitions for a ref name never registered are deleted 90 days after arrival. A closed `handoff_offers` row naming a pruned checkpoint survives with `checkpoint_id` null and its `checkpoint_commit_sha` intact (LAI-546 builds the column; assert once both land).
- [ ] **A delivery that arrives before its checkpoint is registered** is stored, and the registration that follows derives `verified` from it in its own transaction (asserted both ways round, including concurrently).
- [ ] **Registering a re-tag** sets the checkpoint to its new ref's state at that moment — `pending` with `pending_since` restarted when nothing arrived — and is the only change to `verification` no delivery makes (asserted).
- [ ] A registration retry with the same `idempotency_key` and body answers the existing checkpoint `200` even after the session's claim was paused by an offer; a different body is `409` (asserted).
- [ ] Consent: `PUT` / `DELETE` are the owner's, session only; `GET` answers the owner and the agent's own token; no other caller (asserted).
- [ ] **Live test recorded in this file:** whether GitHub sends a `push` delivery for creating and for deleting a `laika-ckpt/*` tag, checked against the real webhook (proposal §4.3.1 marks it Documented-not-tested). If it does not, stop and report before building on it.


### D-116 recovery and ordering — added by CHIEF 2026-10-28 (task still in backlog; D-116 revision 2, PR #99)

Run these against a real configured GitHub repository on the owner's account,
and record the evidence on LAIKA-797.

- [ ] (a) A delivery whose handler fails before applying it, then redelivered
      with the same `X-GitHub-Delivery` id, is applied, and the checkpoint is
      `verified`.
- [ ] (b) A checkpoint whose delivery never arrived becomes `verified` after
      `laika agent checkpoint reverify <id>` pushes `…-r1`. The checkpoint's
      state then follows its newest ref.
- [ ] (c) An `uncertain` or `ref_deleted` ref is never `verified` again,
      whatever later deliveries arrive (D-116a); between those two states the
      set decides. A re-tag, through a new ref, is the only way back.
- [ ] (d) The helper pushes exactly one tag per `git push`. A test documents
      that pushing four tags at once produces no push delivery, which is
      GitHub's three-tag limit.
- [ ] (e) An annotated tag at a checkpoint name leaves that checkpoint
      `uncertain`.
- [ ] (f) A tag ruleset on `laika-ckpt/**/*` with Restrict updates and Restrict
      deletions refuses both moving and deleting a checkpoint tag.
- [ ] (g) Deliveries for the same ref are applied one at a time. A concurrent
      test shows that two handlers cannot interleave.
- [ ] Every state is computed from the set of transitions, never from arrival
      order (D-116a). A delete that arrives before its create reads
      `uncertain`; the create arriving later makes it `ref_deleted`, **never
      `verified`**.

## Tests and UI evidence required

Service + webhook tests with signed fixture deliveries; idempotency; retention job with injected clock.

## Dependencies

`depends-on: [LAI-541, LAI-544]`.

**Blocked on decisions D-115 / D-116 (proposed).** Do not start until both are approved as proposal §8 describes. Board tag `blocked-on-decision`.

`checkpoint_saved` is three-owner: **LAI-544** (SPEC) · **LAI-545** (enum, this task) · **LAI-549** (client mirror).

## Role / machine

CORE on Belka. Owner area: `server` (CORE).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

2–3 days, confidence L.

## Branch

`LAI-545-checkpoints`

## Migration / rollout notes

Additive. Webhook retention job changes only for referenced rows.
