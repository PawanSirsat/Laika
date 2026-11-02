# Developer Access V3 — handoff report (LAI-1075)

Plan: `docs/proposals/LAI-1042-developer-access-v3-plan.md` (#198).
Live acceptance: `docs/acceptance/LAI-1069-developer-access-v3.md` (#223, re-run §8 in #225).
Screenshots (not committed): `.polly/evidence/V3-walkthrough/`, `.polly/evidence/LAI-1065/`.

## State on 2026-11-02

Everything in plan slices A–F is merged to `master` and deployed. Production still
serves the **classic** screens because `LAIKA_DEVELOPER_ACCESS` defaults to
`classic`. Switching is a deploy setting (see Rollout).

**Since LAI-1076 (owner decision, 2026-11-02) the default is `v3`.** A board
whose environment does not set `LAIKA_DEVELOPER_ACCESS` serves V3 from the
first deploy that carries it; see Rollout for going back.

## What was merged

| Slice | PR | Task | What |
| --- | --- | --- | --- |
| A | #199 | LAI-1002 | SPEC drift test reads four-digit task ids |
| A | #200 | LAI-1043 | Build commit in `/health`; `GET /api/v1/developer/compatibility`; `LAIKA_DEVELOPER_ACCESS` flag; `laika version`, `laika doctor` |
| A | #201 | LAI-1044 | Shared wizard parts extracted from Connect (no visual change, golden-tested) |
| A | #203, #208 | LAI-1047, LAI-1053 | D-123 and D-124: the third and fourth named `can()` exceptions |
| B | #202 | LAI-1045 | Migration 0070 `devices`, `agents.device_id`, deterministic backfill; D-122 |
| B | #204 | LAI-1046 | Token `kind` / `agent_id` / `agent_label`; agent credentials never shown as anonymous personal tokens |
| C | #205 | LAI-1050 | Device pairing (16-char single-use code, Ed25519 proof, fingerprint approval), migration 0071 |
| C | #211 | LAI-1056 | Add tool / redeem by device signature / reconnect / per-tool evidence / client reports, migration 0072; D-125 |
| C | #213 | LAI-1060 | `laika device pair`, `laika tool add`, `install.sh --no-credential` |
| C | #216, #219 | LAI-1062, LAI-1064 | Feature flags read from mounted routes; server and CLI at protocol 2 |
| D | #206 | LAI-1048 | V3 shell, tabs, legacy redirects, Overview |
| D | #209 | LAI-1052 | Project setup: membership vs agent grant, safe tool-specific prompt |
| D | #210 | LAI-1054 | Devices tab: devices hold tools, imported/duplicate/revoked handling |
| D | #212 | LAI-1058 | Advanced (personal credentials only, 90-day default) and Activity; outside-page wording |
| D | #215 | LAI-1061 | Add device and Add tool wizards with honest checks |
| E | #207 | LAI-1051 | `laika update` to the board's own commit, anchored source, staged, rollback |
| E | #218 | LAI-1065 | Update status on tool rows; What's new |
| E | #222 | LAI-1067, LAI-1068 | Client report after update; protocol drift test |
| G | #221, #224 | LAI-1066, LAI-1073 | `project_repo_setups` (migration 0073), `laika project check`, privacy fixes |
| F | #223 | LAI-1069 | Live walkthrough report; board build line on Organisation Overview |
| F | #225, #226 | LAI-1070–1072, LAI-1074 | Walkthrough defects; Claude Code MCP entry via `headersHelper` |
| — | #214, #217 | LAI-1059, LAI-1063 | Master CI timeouts; agent-session model report races |

Every behaviour-changing PR had a separate review (same vendor, Claude only, by the
owner's choice); security PRs went two to three rounds.

## Contracts

- **Compatibility:** `GET /api/v1/developer/compatibility` — public, D-123. Protocol
  `{current: 2, min_client: 1}`; features `device_pairing`, `tool_setup_exchange`,
  `client_reports`, `project_setups` derived from mounted routes; `developer_access`
  from the flag.
- **Pairing:** owner session creates and approves; device claims with a public key and
  completes by signing (D-124). No token is minted during pairing.
- **Tool setup:** owner session adds a tool to a paired device; the device redeems by
  signature and receives the token once (D-125, SPEC §6.1). Reconnect rotates atomically.
- **Evidence:** `GET /agents/:id/verification`; Ready only from that tool's own request,
  required capabilities and session hooks where they exist.
- **CLI:** `laika version`, `doctor`, `update`, `device pair`, `tool add`, `project check`,
  all gated on the board manifest with old-board fallbacks.

## Migrations

0070 devices, 0071 pairing requests, 0072 tool setup exchanges and client reports,
0073 project repo setups. All additive. Existing agents keep their ids, owners, labels,
grants, tokens, consent, claims and history; legacy duplicates are kept and shown.

## Rollout and rollback

`v3` is the default (LAI-1076): a board with `LAIKA_DEVELOPER_ACCESS` unset
serves V3, and classic links redirect. The web reads a compatibility answer
it cannot get, or cannot read, as `v3` too.

1. **Rollback:** set `LAIKA_DEVELOPER_ACCESS=classic` in the board's
   environment (production: `/opt/laika/.env` on the instance, read by
   `--env-file` in `.github/deploy/host-restart.sh`) and restart the container.
   The classic screens come back. No data change: nothing the flag gates is
   stored.
2. `LAIKA_DEVELOPER_ACCESS=preview` and a restart shows the V3 tabs beside
   classic, for a side-by-side check.
3. Removing the variable, or setting `v3`, and restarting returns to V3.
4. Database rollback after a failed deploy is separate and uses the snapshot
   restore (LAI-1033).

The classic screens stay in the build until V3 has run in production; deleting
them is a later cleanup.

## Known limits and unverified items

- Not exercised with a real harness process: Claude Code hooks end to end, Codex,
  Cursor, Copilot (CLI/IDE/cloud), Gemini CLI, Antigravity, Omnigent workers.
- Cloud devices, a real `laika update` on an installed machine, keyboard-only pass on
  production.
- The board is plain `http://` on a bare IP: `laika update` needs `--allow-http` with an
  anchored source; HTTPS in front of the board is recommended.
- A pairing claim flood of about 100 requests a second could still delay pairing
  (accepted under D-124; per-address keys need a trusted-proxy setting).
- Follow-ups filed: LAI-1057 (single-project grant write), LAI-1049 (agent tokens reading
  the owner's lists).
