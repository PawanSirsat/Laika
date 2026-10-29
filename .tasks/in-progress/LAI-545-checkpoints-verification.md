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

## Delivered

CORE (Claude Code, dispatched by polly) on Belka, session
`01M641HX1CDPXDNWYF4BTF2FA2`, board claim generation 1. Branch
`LAI-545-checkpoints`, worktree `.polly/wt-545`, cut from
`origin/LAI-544-phase3-spec` at `4e086526` and merged again at `b4193e95` (the
SPEC Codex passed). Built to D-115, D-116, D-116a and SPEC §4.68 – §4.70,
§4.73, §6.4, §10.1, §11.6 as merged.

**What exists.** Migration `0066_checkpoints` (four tables, the activity
CHECK with `task.checkpoint_saved`); `services/checkpoints.ts`;
`POST`/`GET /tasks/:id/checkpoints`, `POST /checkpoints/:id/refs`,
`GET`/`PUT`/`DELETE /agents/:id/checkpoint-consent`; the `checkpoint_task`
tool; actions `task.checkpoint.create`, `task.checkpoint.retag`,
`system.checkpoint.verify`, `system.checkpoint.prune`; the daily
`checkpoint.retention` job. Checkpoint-tag deliveries are applied **ahead of**
the in-memory 24h delivery log (`http/routes/webhooks.ts`): that log records
an id before its handler runs, so a failed handler's redelivery would have
been refused as a repeat — criterion (a) depends on it.

### Live test — not run against GitHub (blocked), and what was checked instead

- A scratch repo `PawanSirsat/laika-ckpt-scratch` was created (private: a
  public one was refused by the session's safety classifier) with a
  push-only webhook. **GitHub recorded no delivery at all for it** — not the
  pings, not a branch push, not the tag pushes — at a `.invalid` URL, at a
  GitHub-owned URL and at `example.com`, polled for a minute each, while the
  Laika repo's own hook delivered normally in the same minutes. No cause
  found. **A local capture needs a public tunnel**, which is the surface the
  classifier refused. **Deleting a remote tag is refused by this session's
  blast-radius hook**, so the delete half could not have run either.
- Pushed to the scratch repo (no delivery recorded): one lightweight tag
  alone; one annotated tag (object `461590b3…`); four tags in one push; three
  tags in one push.
- **Instead, GitHub's own documentation, fetched 2026-10-29**
  (`docs.github.com/api/article/body?pathname=/en/webhooks/webhook-events-and-payloads`):
  *"This event occurs when there is a push to a repository branch. This
  includes when a commit is pushed, when a commit tag is pushed, when a
  branch is deleted, when a tag is deleted …"*; *"Events will not be created
  for tags when more than three tags are pushed at once."*; `ref` *"The full
  git ref that was pushed. Example: … refs/tags/v3.14.1"*; `before`/`after`
  *"The SHA of the most recent commit on ref before/after the push"*;
  `created`, `deleted` booleans. The code reads only `ref`, `before`, `after`
  and `repository.full_name`.
- **Still owed, for the owner:** (d), (f), and the live halves of (a), (b),
  (c), (e), (g) need a webhook GitHub actually delivers to (the Laika repo's
  own, after this deploys, is the obvious one) and permission to delete
  remote tags. The scratch repo can be deleted.

### Deviations — where the task file and the SPEC differ, and what was built

1. **No branch verification.** The original scope said *"or the work branch
   at exactly the checkpoint SHA"*; D-116 and §10.1 verify by tag only. Built
   to the SPEC; a branch push at the same SHA is asserted to change nothing.
2. **The set rule is D-116a's**, not the original *"a create received after a
   delete restores verified"*: a lone deletion is `uncertain`; adding the
   creation makes it `ref_deleted`, never `verified`; two deletions are still
   `ref_deleted`; a deletion from another SHA is `uncertain`.
3. **`pending_notice`** is a field the read adds beside §6.4's `pending_since`:
   the 10-minute window is server configuration, so the server says whether
   it has passed. Not in §6.4's shape — CHIEF to add or refuse.
4. **The tag's task segment** is the task's `external_ref` only when it is a
   safe ref segment (`[A-Za-z0-9][A-Za-z0-9_-]{0,99}`), else its key.
   `external_ref` is free text (§4.5); §6.4 says *external_ref when it has
   one* and does not say what happens when Git would refuse it.
5. **Re-tag refusal reasons** §6.3 does not name: `not_an_agent` for a person
   or a legacy token, `not_the_owners_agent` for another owner's agent. A
   retried key with another body is `409`, `reason: idempotency_key_reused`.
6. **Cancelled tasks' retention counts from `updated_at`**: `cancelled` has no
   timestamp of its own (§4.5), and `updated_at` is never earlier than the
   cancel, so a row is kept longer, never pruned early.
7. **The closed-offer half of the retention criterion is LAI-546's**:
   `handoff_offers.checkpoint_id` (`ON DELETE SET NULL`) and
   `checkpoint_commit_sha` do not exist yet. The prune deletes checkpoints
   with nothing referencing them; the assertion lands with LAI-546.
8. **Deliveries for a name no project's repo tracks are dropped, not
   stored** — §4.70 stores rows only for the configured repo.

### Reds left on this branch, and whose

LAI-545's own are all green. Remaining:

- **CHIEF (docs):** `schema-spec-drift.test.ts` › *has no planned mark that has
  outlived its reason* and its four *§4.68/§4.69/§4.70/§4.73 — planned,
  LAI-545* cases, plus *works on the real document* (expects one planned
  section, finds five): remove the four `**Planned — LAI-545.**` lines.
  `parity.test.ts` › *agrees with §7.2 about how many have REST twins* —
  *"§7.2 says "eighteen" tools have twins; the server has 19"*; and *the
  README names the tools* — `checkpoint_task` missing from `README.md`'s MCP
  tools table.
- **LAI-546:** `parity.test.ts` › *names exactly the registered tools* —
  missing `agent_sync`, `offer_handoff`, `respond_handoff`;
  `policy-spec-drift.test.ts` › the six hand-off rows; `schema-spec-drift`
  › the `handoff_offers` / `tasks.handoff_count` /
  `project_handoff_policies.updated_by` columns and the seven hand-off verbs.
- **LAI-549 (SHELL, client mirror), verbatim:**
  `server/web/test/api/use-events.test.ts` › *STREAM_TYPES equals
  ACTIVITY_TYPES, in order*; `server/web/test/api/activity-labels.test.ts` ›
  *every type the server emits has wording*;
  `server/web/test/routes/screens/dashboard/dashboard-derive.test.ts` ›
  *covers every verb the server can write* — each for `task.checkpoint_saved`.
- **SHELL (cli), verbatim:** `cli/test/plugin-mcp.test.ts` › *the tool surface,
  from both sides* › *and they are exactly these* — `+ 'checkpoint_task'` (its
  hard-coded list needs the tool); and › *§7.1 and the registry name exactly
  the same tools* — `agent_sync`, `offer_handoff`, `respond_handoff` (LAI-546).
  Run with `node --test test/plugin-mcp.test.ts`: exit 1, 5 pass, 2 fail.

### Verification (touched files only, one at a time, `uptime` first — the owner's rule)

From `server/`, each `npx vitest run <file>`, exit codes:
`test/http/routes/checkpoints.test.ts` 0 (44 tests) ·
`test/services/checkpoints.test.ts` 0 (22) · `test/mcp/claims.test.ts` 0 (11)
· `test/policy/matrix.test.ts` 0 (84) · `test/services/permissions.test.ts` 0
(34) · `test/jobs/scheduler.test.ts` 0 (16) · `test/http/routes/webhooks.test.ts`
0 (25) · `test/http/routes/agents.test.ts` 0 (36) · `test/db/schema.test.ts` 0
(19) · `test/db/migrate.test.ts` 0 (39) ·
`test/tooling/schema-migration-drift.test.ts` 0 (9) ·
`test/tooling/activity-payload-names.test.ts` 0 (17) · `test/mcp/parity.test.ts`
1 (3 failed, 26 passed — the three above) ·
`test/tooling/policy-spec-drift.test.ts` 1 (LAI-546's six rows) ·
`test/tooling/schema-spec-drift.test.ts` 1 (as above). `pnpm run typecheck` 0.
`npx eslint` on the 24 changed `.ts` files 0; `npx prettier --check` on them 0.
Counts are test cases as vitest reports them.

**Mutation proof**: 19 mutants of `services/checkpoints.ts` and
`routes/webhooks.ts`, each checksum-verified as applied and restored, each
run against the two checkpoint test files — **all 19 red**, after one
survivor (`newest-ref-ignored`) got its test. A no-op control is refused by
the harness, so a mutant that did not land cannot report green.
