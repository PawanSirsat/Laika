---
id: LAI-590
title: 'Devices view — server half: agents grouped by device, last seen per device, revoke a whole device, unrecognised device flagged'
area: server
assignee: CORE
priority: p1
depends-on: [LAI-586]
discovered-from: LAI-532
status: review
started: 2026-10-29T07:42:31+00:00
finished: 2026-10-29T08:07:49+00:00
---

Phase 2.5 slice from `docs/proposals/LAI-532-phase-index.md` (PR #121,
branch `LAI-532-identity-model-decisions`). Builds on D-118 (*one agent per
harness per device*, proposed in `docs/proposals/LAI-532-agent-identity-model.md`).
The web half is LAI-591. Board card: LAIKA-844, parent LAIKA-785.

## Goal

A person can answer "what is running on which machine, and is any of it not
mine?" from the server: their agents grouped by device (Belka, Strelka, Cloud,
another person's laptop where they registered a credential), when each device
was last seen, a single action that revokes every agent on one device, and a
flag on a device the owner has not confirmed as theirs.

**User-visible outcome (through LAI-591):** Settings › Agents shows one row per
device with its agents under it and "last seen 4 min ago"; *Revoke device*
ends every agent on that laptop at once; a device the owner never confirmed
reads *Not recognised*.

## Scope

- A **device** is the owner's agents that share one normalised `device_label`
  (trimmed, case-folded; `null` reads as *Unnamed device*). It is derived, not
  a free-standing identity: the label stays self-reported and decides nothing
  (§4.63).
- **Recognised** is the owner's own statement, stored per owner per normalised
  label (new table or column — the builder chooses and SPEC records it). A
  device becomes unrecognised when an agent first appears on a label the owner
  has never confirmed. Confirming is behind `agent.manage_own`, session only.
- `GET /agents/devices` (name is the builder's, SPEC records it): the caller's
  own agents grouped by device — label, recognised yes/no, `last_seen_at` = the
  newest `agents.last_seen_at` on that device, active / revoked counts, the
  agents with their harness and status. `agent.read_own`; another person's
  agents never appear.
- `POST /agents/devices/revoke` with the label: revokes every **active** agent
  of the caller on that device and every live token they hold, **in one
  transaction**, using the existing per-agent revoke path so sessions end with
  `agent_revoked` and claims drop exactly as revoking one agent does today.
  `agent.manage_own`, session only — no token, an agent's own included, can
  call it. Returns the revoked agent ids.
- A matching MCP read only if §7.1 already reads agents; no MCP revoke.

## Exclusions

- No UI (LAI-591). No CLI. No new §4.8 verb: revoking writes the existing
  `token.revoked` rows per token, as §4.63 already says.
- No device fingerprinting, IP or user-agent capture. The label is what the
  agent says it is; *Not recognised* is the owner's own list, not detection.
- Cloud and other people's laptops as policy (short-lived credentials, stated
  owner) are LAI-592.

## Acceptance criteria

- [x] The device list groups the caller's own agents by normalised
      `device_label`, with `last_seen_at` = the newest agent `last_seen_at` on
      the device, active/revoked counts and each agent's harness and status
- [x] Another person's agents never appear, and their device label is never
      revealed; a revoke naming a label only another person uses changes
      nothing and answers as an unknown device (`404`)
- [x] Revoke-device revokes every active agent on that device and every live
      token they hold in one transaction; their sessions end `agent_revoked`;
      their claims drop as single-agent revoke does today; agents on other
      devices and the owner's personal tokens are untouched
- [x] Revoke-device and confirm-device refuse any token (`403`), an agent's own
      included — session only, `agent.manage_own`
- [x] A label the owner has not confirmed reads `recognised: false`;
      confirming flips it; a new agent on a new label reads unrecognised
- [x] Additive migration (if a table or column is added): every existing row
      kept, tested on a populated database; existing agents' devices start
      **recognised** (they were registered by the owner from a session)
- [x] SPEC: §4.63 (and a new §4.x if a table is added), the endpoint rows in
      §6, and the §3.1 actions used — only what the guards force
- [x] Tests: REST for list, revoke, confirm, the no-leak case and the token
      refusal; each rule broken on purpose and the matching test seen red
- [x] Gate: repo-root `pnpm test`, `pnpm lint`, `pnpm format` each exit 0

## Dependencies

- LAI-586 (LAIKA-843) — D-119 and the session harness / version / model
  fields; this builds on the agents and sessions shape it settles.
- D-118 / D-119 approval from Pawan's own account (PR #121) before merge.
- Blocks LAI-591 (web) and LAI-592 (cloud and shared devices).

## Role, machine, effort

- Role: CORE. Machine: **Belka** (`host-belka`). Cross-vendor review.
- Effort: **M**. Confidence: **medium** — the revoke reuses the per-agent path;
  the unknown is where *recognised* lives.

## Tests and evidence

- Vitest REST tests under `server/test/` beside the existing agents tests;
  a migration test on a populated database if the schema changes.
- No UI evidence here; the screenshots belong to LAI-591.

## Rollout

Additive and behind no flag: the new endpoints are unused until LAI-591 ships.
Existing devices start recognised, so nothing reads *Not recognised* on day
one. Rollback is a revert; a new table can stay empty.

## Implementation context

Owner-directed CORE implementation on Belka, in `.polly/wt-590`, branch
`LAI-590-devices-server`. Per the owner's explicit instruction, starts against
`origin/LAI-586-selected-agent-owns-claim` (PR #123), while LAI-586 is in review,
rather than waiting for its merge. No merge or decision approval is implied.
The owner authorised touched tests, lint and format locally; the full test
gate runs in PR CI because Belka is overloaded.

## Submission notes (CORE, Claude Code on Belka)

Took over Codex's uncommitted draft and reviewed it. Kept: the table, the
Unicode key function used by the migration, the outer-transaction revoke and
the route order. Fixed: two tests that were wrong. One read a `claim` field
that `GET /tasks/:id` does not return. The other bound a variable inside a
trigger. Claims now assert today's single-agent behaviour: the row is
unchanged, it is held until the lease ends, then it expires. Reverted the
draft's §3.1 row rewording, which broke `policy-spec-drift`. Added the 0065
populated-db test, `test/db/device-label.test.ts`, and the new table in the
schema guards.

Recognised lives in a new table, `recognised_agent_devices` (§4.67). No MCP
tool was added, because §7.1 has no tool that reads agents.

**Gate criterion, submitted red per §4.4.** The full gate runs in PR #132 CI.
One assertion is expected to fail, in SHELL's area:
`server/web/test/api/endpoint-coverage.test.ts` "no endpoint is served,
uncalled and unexplained" lists `api/v1/agents/devices`, `…/confirm` and
`…/revoke`. LAI-591 adds the callers and turns it green.
`NO_BROWSER_CALLER` is not touched from here.

Board: `start_working` answered `409 claim_held`, because the stopped Codex
session still holds the claim. The card was not moved to Review.
