---
id: LAI-592
title: 'Cloud and shared devices: <harness> · Cloud agents with short-lived credentials and a stated owner; another person''s laptop is their agent'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-590]
discovered-from: LAI-532
status: backlog
---

Phase 2.5 slice from `docs/proposals/LAI-532-phase-index.md` (PR #121). Two
owners (§4.4): **docs** — a proposed decision and the SPEC rows — and **CORE**
— the server rule. Named docs edits this task authorises (D-033): a new
proposal section in `docs/proposals/LAI-532-agent-identity-model.md` (or a
sibling proposal file) and SPEC §4.63 and §4.9; nothing else under `docs/`.
Board card: LAIKA-846, parent LAIKA-785.

## Goal

A cloud runner is a device like any other, named `<harness> · Cloud`, but its
credential lives briefly and the agent always says which person it acts for.
And an agent on someone else's laptop is **that person's** agent under their
own owner (D-114), never a credential of yours left on their machine.

**User-visible outcome:** the Devices view (LAI-591) shows a *Cloud* device
whose agents read "Codex · Cloud — owner Pawan — credential expires in 50 min";
registering an agent for a colleague's laptop is refused, with a line telling
the colleague to register their own.

## Scope

- **docs:** a proposed decision (numbered by Belka when recorded; D-120 if
  free) covering: cloud agents carry a token with a mandatory short expiry
  (proposed default ≤ 24 h, the builder proposes the number with a reason);
  the owner is the person who registered it and is shown on every line that
  names it; a laptop that is not the owner's carries the laptop owner's own
  agent. Approval from Pawan's own account, as D-118/D-119.
- **CORE:** an agent marked cloud (device label `Cloud`, or a field the
  decision chooses) can only hold tokens with an expiry within the limit;
  minting one without, or longer, is `422`; an expired token is refused as any
  expired token is today. The owner's display name is on the agent read and
  device list.
- **CORE:** the stated-owner rule is enforced by what exists: an agent's owner
  is always the session user who registered it (§4.63); add no way to register
  an agent for another user. A test proves that path stays closed.

## Exclusions

- No cloud runner integration, secrets store or CI wiring; Laika only bounds
  the credential.
- No UI change beyond fields LAI-591 already renders; if new UI is needed it is
  a new SHELL task.
- No change to D-114's owner-cap rule.

## Acceptance criteria

- [ ] docs: the proposed decision is written and linked from the phase index;
      SPEC §4.63 and §4.9 record the cloud expiry rule; nothing else in
      `docs/` is touched
- [ ] Minting a token for a cloud agent with no expiry, or past the limit, is
      `422` with a `code` naming the rule; within the limit it succeeds
- [ ] A cloud agent's expired token is refused exactly as an expired personal
      token is; the agent's other devices are untouched
- [ ] Agent reads and the device list carry the owner's display name
- [ ] No route or tool registers an agent whose owner is not the calling
      session user; a test asserts the refusal
- [ ] Tests: REST for each rule, each broken on purpose and seen red
- [ ] Gate: repo-root `pnpm test`, `pnpm lint`, `pnpm format` each exit 0

## Dependencies

- LAI-590 (Devices view, server half) — the device list this extends.
- The proposed decision needs approval from Pawan's own account before merge.

## Role, machine, effort

- Role: Belka (CHIEF for the docs half, CORE for the server half), §4.4.
  Machine: **Belka** (`host-belka`). Cross-vendor review.
- Effort: **L**. Confidence: **low** — the cloud marker and the expiry limit
  are open questions until the decision is written.

## Tests and evidence

- Vitest REST tests beside the agents and tokens tests. No UI evidence in this
  task.

## Rollout

The decision first, then the server rule. Existing agents are not cloud agents,
so nothing changes for them. A cloud agent registered before the rule ships
keeps working until its tokens are rotated; rollback is a revert.
