---
id: LAI-1056
title: 'Developer access V3 slice C2: tool setup exchange, verification evidence, client reports (server)'
area: server
assignee: core
priority: p1
depends-on: [LAI-1050]
started: 2026-11-02T16:30:00+05:30
status: review
finished: 2026-11-02T18:40:00+05:30
---

Slice C2 of `docs/proposals/LAI-1042-developer-access-v3-plan.md` (§D.2
tables 4 and 5, §E.2, §E.3, §E.7, §H, §J slice C, §K, §L2, §L4, §L5).

**The dependency deviates from the claim rule.** LAI-1050 (PR #205) is in
review, not in `done/`. The owner's dispatch stacks this branch on
`LAI-1050-device-pairing`. #205 has since merged into `master`
(`db8d2eb0`), and so has #209 (LAI-1052). `origin/master` is merged in, the
PR targets `master`, and the migration stays `0072`, next after `0071`.
Nothing here uses the pairing failure key or `RateLimiter.peek`, which #205
removed.

**Out of scope here:** project setup (E.5, `project_repo_setups`, LAI-1052),
the Devices tab (web), `laika update` (cli).

## Scope (CORE, `server/` except `server/web/`, plus named SPEC rows)

1. **Add tool**: `POST /api/v1/devices/:id/tools`, session only
   (`agent.manage_own`), on a paired, active device of yours. Reuses your one
   active agent for (device, harness), or registers one. More than one active
   is `409 agent_duplicates_need_resolution` naming them, and none is picked.
   Answers the agent, an exchange id and a command with no secret. The
   exchange row stores no secret. `POST /agents/:id/reconnect` makes a
   `rotate` exchange for an existing agent; `DELETE /tool-setup/:id` cancels.
2. **Redeem**: `POST /api/v1/tool-setup/:id/redeem`, by the paired device.
   It signs a server challenge with its own prefix, bound to the exchange id,
   device id and board origin. The token is minted at redemption and returned
   once (`markOneTimeSecret`); only its hash is stored. Single use, ten
   minutes, bound to owner, board and device. Its own rate-limit bucket keyed
   per exchange, so nobody can lock out others. A cloud device gets a token
   of at most 24 h. A `rotate` revokes the old token in the same transaction.
3. **Evidence**: `GET /api/v1/agents/:id/verification`. MCP `initialize` on
   an agent's own token records the client's own slug and name, flagged
   self-reported. The status inputs let the UI tell Needs setup, Connected,
   Ready, Idle and Offline apart, and none of them is Ready from a curl, a
   generic token or another tool's request.
4. **Client reports**: `POST /api/v1/agents/me/client-report`, agent token
   only. A strict schema with length caps, self-reported, never read for a
   permission.

No new activity verb (L4). No new §3.1 action (L5).

## Named cross-area edits (D-033, D-034)

- `docs/SPEC.md`: new §4.80 `tool_setup_exchanges` and §4.81
  `agent_client_reports`, one paragraph in §6.3 (the redeem bucket), and
  seven §6.4 endpoint rows. No other section is touched.
- `server/web/test/api/endpoint-coverage.test.ts`: six `NO_BROWSER_CALLER`
  entries for the new endpoints, the shape LAI-1050 added for pairing. No
  other line.

## For CHIEF

- **Redeem is not D-124's fourth case** and does not claim to be: it yields a
  credential, which condition 1 forbids. It calls
  `can(owner, 'agent.manage_own')` on the owner who made the exchange,
  loaded at redeem (`loadActor`), so a deactivated owner, or one whose role
  no longer allows it, mints nothing; that is one uniform `404`. **The
  authentication is the device's signature, not a session or a token.** That
  is a way of acting for the owner that §6.1 ("There is no third path") does
  not describe. Plan §E.1 already says it needs a named §6.1 paragraph from
  CHIEF, and this task does not write one.
- **The challenge step answers before any signature.** A redeem without
  `signature` returns the exchange's stored challenge. It is not a secret,
  and `can(owner)` is asked before it is returned.
- **This is the reconnect path the #204 admin copy points at**:
  `POST /agents/:id/reconnect` makes a `rotate` exchange, and redeeming it
  revokes every live token of the agent in the same transaction.
- **Honest gap:** Omnigent and Hermes send `clientInfo.name = "mcp"`, which
  names no tool, so `tool_request` never passes for them. Plan §M says
  Omnigent's Ready "relies on the MCP initialize clientInfo". That evidence
  does not exist today, and nothing here fakes it.
- **Not built:** `claims_supported` (the plan puts the capability table in
  the web, §E.6), a `grants` body on add tool (least privilege: grants go
  through the existing `PUT /agents/:id/grants` or LAI-1052's per-project
  route), and `POST /devices/me/report`.

## Acceptance criteria

- [x] Migration 0072 adds `tool_setup_exchanges` and `agent_client_reports`,
      additive only; no secret column.
- [x] Add tool: reuse one active agent, register when none, `409` on
      duplicates, `404` byte-identical for another owner's device, session only.
- [x] Redeem: once; replay `409`; wrong device key `401`; expiry `409`; cloud
      token at most 24 h; rotate atomic, so the old token dies in the same
      transaction while identity, grants and history are kept.
- [x] No plaintext token at rest; the secret appears in no response but the
      single redeem.
- [x] Rate limit per exchange: a flood against one exchange cannot stop
      another from redeeming.
- [x] Evidence comes only from the agent's own credential; another tool's
      request, or a personal token, does not count.
- [x] Client report: strict schema and caps; agent token only; old clients
      unaffected.
- [x] SPEC rows for the new routes and tables.

## Review notes — PR #211 round 1 (CHIEF, 2026-11-02)

FAIL on one blocker; the security core passed.

- **B1:** with presence off, timestamps still show. `recordMcpClientReport`'s
  `unchanged` check skips the write when `reportedAt === null`, so a row
  stamped while presence was on keeps its time. Gate at read time too.
- **N1:** at redeem, re-check `agent.device_id === row.device_id` and the
  device's owner; otherwise `404`.
- **N2:** the `MAX_FAILED_SIGNATURES` comment should say the fifth cancels.
- **N3:** add tool matches agents by `device_id` or by label key.
- **N4:**
  - an unsigned request on a non-open exchange gets `409`, not the
    challenge;
  - test the `device_revoked` branch;
  - the sibling-agent verification `404` compares bodies;
  - the rotate-on-add answer says that redeeming revokes the live tokens.
- **Omnigent/Hermes evidence (CHIEF decision):**
  - for a harness whose MCP client name is generic, the tool request passes
    on an MCP request on the agent's own live token plus a client report
    from the same token naming the harness, marked self-reported;
  - Ready also needs that harness's required capabilities;
  - one table per harness, with a test.
- **Named CHIEF-area edits (D-033):** SPEC §6.1, the sentence and one
  verbatim paragraph; `docs/DECISIONS.md` D-125.

### Round 1 fixes (`cf131005`, `a00bdd45`)

- **B1:** `recordMcpClientReport` now rewrites a row that carries a time
  while presence is off. `getAgentVerification` nulls `tool_request.at` and
  `client_report.reported_at` whenever presence is off. Test: presence on,
  initialize, presence off, read and initialize again; `at` is null and the
  stored time is gone.
- **N1:** redeem refuses another owner's device, and an agent moved off the
  device, with the uniform `404`.
- **N2:** the comment now says the fifth bad signature cancels.
- **N3:** add tool matches an agent by `device_id` or by label key. Tested
  with a drifted label.
- **N4:**
  - an unsigned redeem of a non-open setup is `409 exchange_<state>`, and
    never returns the challenge;
  - the `device_revoked` branch is tested;
  - the sibling `404` body is compared with the unknown one;
  - `revokes_on_redeem` lists the tokens a redeem revokes, and is empty for
    `install`.
- **D-125 evidence:**
  - `server/src/services/harness-evidence.ts` holds `HARNESS_EVIDENCE`, a
    `Record<AgentClient, …>`, tested by name;
  - omnigent and hermes are generic and need `tool_setup_exchange` and
    `client_report`; `other` is unverifiable;
  - the client report gains `harness`, and `agent_client_reports.harness`
    is added in 0072, which is unreleased and was regenerated in place;
  - the new check `required_capabilities` gates Ready.
- **Named edits:** SPEC §6.1, the sentence and the verbatim paragraph;
  `docs/DECISIONS.md` D-125.
- Eight mutants, one per fix, each went red in its own test.

**A tension for CHIEF:** the verbatim §6.1 paragraph says "Refusals before
the signature are one `404`", but N4 makes an unsigned request on a spent,
expired or cancelled setup a `409`. That request names both ids, the
exchange's and its device's, so a caller who is not the device learns one
thing: the state of an exchange whose ids they already hold. Either the
sentence or N4 should give way; this PR does what each asked.
