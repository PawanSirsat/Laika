---
id: LAI-1045
title: 'Developer access V3 slice B1: devices table, agents.device_id, deterministic backfill, owner-only device reads'
area: server
assignee: core
priority: p1
depends-on: []
started: 2026-11-02T02:26:39+05:30
status: review
finished: 2026-11-02T02:45:05+05:30
---

Slice B1 of the merged plan `docs/proposals/LAI-1042-developer-access-v3-plan.md`
(§A3, §A4, §D, §E device views, §I, §J slice B, §K, §L1). A device stops being
only a normalised label and gets a server row, **without changing anything a
client sees today**.

## Scope (CORE, `server/` except `server/web/`)

- Migration `0070` (next free on `master`): table `devices` and a nullable
  `agents.device_id`. Additive only, no table rebuild.
- The pairing, exchange, client-report and repo-setup tables of plan §D.2 are
  **not** in this migration. Nothing in the plan needs them to land together,
  and an unused table is a SPEC section with no behaviour behind it. Slice C
  adds them in its own migration.
- Backfill in the migration SQL, plus the same rule as an idempotent boot step
  (`backfillAgentDevices`) that fills only `device_id IS NULL`.
- `registerAgent` and `updateAgent` link the agent to the active device for its
  label, creating one if there is none.
- The cloud 24 h rule applies when the label key is `cloud` **or** the agent's
  device has `kind = cloud` (plan §L1; D-122 amends D-121 item 2).
- `services/devices.ts` and owner-only reads `GET /api/v1/devices` and
  `GET /api/v1/devices/:id` (`agent.read_own`, plan §L5). Another owner's device,
  or an unknown id, is the same `404`.

## Named cross-area edits (D-033)

- `docs/SPEC.md` §4.63 (the `device_id` row and the cloud sentence), a new
  §4.78 `devices`, and the two §6.4 endpoint lines.
- `docs/DECISIONS.md`: D-122, amending D-121 item 2. Approved by the owner in
  chat on 2026-11-02, on standing instruction.
- `server/web/test/api/endpoint-coverage.test.ts`: one `NO_BROWSER_CALLER`
  entry each for `api/v1/devices` and `api/v1/devices/*`, naming the V3 Devices
  screen (plan slice D) as the caller to come. SHELL's file, and the only way
  to keep the gate green before the screen exists (CLAUDE.md §4.4 step 2).

## Acceptance criteria

- [x] `0070` adds `devices` and `agents.device_id` with no table rebuild.
      `devices` has a partial unique index on `(owner_user_id, label_key)`
      where `status = 'active'`.
- [x] The backfill makes one `imported` device per (owner, label key), named as
      `GET /agents/devices` names it today, with `confirmed_at` taken from
      `recognised_agent_devices`. It links every agent. A key whose agents are
      all revoked gets a `revoked` device.
- [x] Nothing is merged, revoked or renamed, and no agent is created. On a
      populated, production-shaped database the agents, tokens, grants,
      sessions, claims, consents and activity rows are byte-identical before and
      after, apart from the new `device_id`.
- [x] The boot backfill changes nothing the second time it runs, and links an
      agent inserted afterwards with a null `device_id`.
- [x] A large-data backfill is timed and the time is recorded.
- [x] Rollback is rehearsed by restoring the pre-migration snapshot.
- [x] `device_label` stays authoritative for the one-tool-per-device rule. The
      24 h rule also applies when the device has `kind = cloud`.
- [x] `GET /devices` and `GET /devices/:id` return the caller's own devices
      only. Another owner's device and an unknown id get byte-identical `404`
      bodies.
- [x] `GET /agents/devices` and every agent response are unchanged.
- [x] D-122 and the SPEC rows are written.
- [ ] CI is green on the PR.

## Dependencies

None in `.tasks/`. The plan (LAI-1042) merged to master in PR #198 without a task file; it is the brief, not a dependency the claim check can read.
