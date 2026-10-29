---
id: LAI-545
title: 'Checkpoints: idempotent registration, verification from signed push deliveries only (D-083), ref_deleted, retention'
area: server
assignee: core
priority: p1
depends-on: [LAI-541, LAI-544]
discovered-from:
status: in-progress
started: 2026-10-29T15:47:30Z
---

Implements **proposal §4.3, §4.3.1** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

An agent session registers a checkpoint for work it has pushed, and
Laika marks it `verified` only when a signed push delivery for the project's
configured repo contains that SHA on that ref — never by calling GitHub.

## Scope

- Migration: `task_checkpoints` (immutable rows), unique `idempotency_key`.
- Register endpoint + `checkpoint_task` MCP tool; fenced by claim generation.
- Verification from `/webhooks/github` push deliveries; a ref-deleting delivery → `ref_deleted`; late delivery verifies a `pending` row.
- Retention: delivery rows referenced by a checkpoint kept 90 days.
- `checkpoint_saved` enum + CHECK.
- States `pending`, `verified`, `ref_deleted` and informational `superseded` (proposal §4.3.1).
- A verified ref is the tag `laika-ckpt/<LAI-NNN>/<checkpoint-id>` or the work branch at exactly the checkpoint SHA, in the project's configured repo only (`422 repo_not_configured` otherwise).
- Dedupe by `X-GitHub-Delivery` using the existing mechanism; state per ref derived from the *set* of deliveries received, not the latest.
- `pending_since` exposed so the UI can show the 10-minute no-notice message; the window is configurable.
- Retention: checkpoint and referenced delivery rows kept at least 90 days after the task reaches Done or Cancelled (configurable). Laika never deletes tags.

## Out of scope

- Offers (LAI-546)
- The helper (LAI-547)

## Acceptance criteria

- [ ] Registering twice with one key returns the same row and writes one `checkpoint_saved` (asserted).
- [ ] No code path makes an outbound HTTP request (asserted by a test that fails on any network call).
- [ ] The manifest names files and counts only; no file content, diff or prompt text is stored (asserted by schema and a test).
- [ ] A checkpoint with failing tests is valid and stores the status as given.
- [ ] Repo-root gate exits 0, or red only on the client mirror assertion quoted verbatim, retired by LAI-549.
- [ ] Without a matching signed delivery a checkpoint stays `pending`; a delivery putting the tag `laika-ckpt/<LAI-NNN>/<checkpoint-id>` (or the branch) at exactly the SHA makes it `verified`; a later `deleted: true` delivery for the tag makes it `ref_deleted`; a newer verified checkpoint on the same claim marks the older one `superseded` (informational).
- [ ] Processing the same `X-GitHub-Delivery` twice changes the state once (asserted).
- [ ] Out of order: a delete wins over a create received *earlier*; a create received *after* a delete restores `verified` (both orders asserted).
- [ ] A checkpoint is never `verified` on the agent's word: no API field or MCP argument can set it (asserted).
- [ ] A checkpoint in a repo other than the project's configured one is refused `422 repo_not_configured`.
- [ ] After 10 minutes (configurable, injected clock) still `pending`, the checkpoint read reports it so the UI shows "Verification pending — no push notice from GitHub yet".
- [ ] The service exposes the accept-time check LAI-546 calls: a differing `verified_commit_sha` is `422 checkpoint_mismatch`; a non-`verified` checkpoint is `409 checkpoint_unverified`.
- [ ] Retention keeps checkpoint and referenced delivery rows 90 days after Done/Cancelled (injected clock), then the usual 30-day rule applies.
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
- [ ] (c) An `uncertain` ref stays `uncertain` whatever later deliveries
      arrive. A re-tag clears it.
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
      order. A delete that arrives before its create gives `uncertain`, and
      the create arriving later does not make it `verified`.

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
