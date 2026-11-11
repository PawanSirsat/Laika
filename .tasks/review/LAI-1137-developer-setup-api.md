---
id: LAI-1137
title: 'Developer setup read for owners and admins; admin revoke of a tool and device unpair'
area: server
assignee: core/belka
priority: p2
depends-on: [LAI-1136]
status: review
started: 2026-11-05T16:52:00+05:30
finished: 2026-11-05T17:30:00+05:30
---

## Why

T4 of `.polly/plans/time-report-programme.md` (§2.4), D-132, D-133, D-134,
D-135. Owners and admins read a member's whole developer setup, read-only and
logged, and may revoke a member's tool or unpair their device, with a notice
to the member — never on the owner's setup for an admin. Card LAIKA-1000, a
subtask of LAIKA-997 (LAI-1133). **High risk**: acting on another person's
credentials; needs an independent security review before merge.

## Named crossings

- `docs/SPEC.md` §3 (the grant renamed *See and manage anyone's developer
  setup*), §3.1 (two rows and their paragraphs), §4.59 (`developer_setup`
  kind), §4.63 and §4.78 (`revoked_by_user_id`, and the 404 exception
  noted), §6.4 (three endpoints, and the notice on
  `DELETE /users/:id/tokens/:tokenId`).
- `server/web/src/api/people-analytics.ts`: `ANALYTICS_VIEW_KINDS` gains
  `developer_setup`, and `VIEW_KIND_LABELS` its one entry (the map is a
  `Record` over the kinds, so the web type check needs both).
- `server/web/test/api/endpoint-coverage.test.ts` `NO_BROWSER_CALLER`: the
  three new paths only, reason *LAI-1140 — Developer setup tab*.

## Acceptance criteria

- [x] `GET /people/:id/developer-setup`: a member, viewer, space admin or any
      token is refused `403` (a token `session_required`); yourself is
      `422 use_developer_access`; an unknown id is `404` to a holder.
- [x] Every read writes one `developer_setup` look, deduped inside ten
      minutes; a refused read writes none.
- [x] No pairing code, code hash, token secret or token hash is in the
      response (asserted by searching the JSON for the stored values).
- [x] A space the reader cannot open is counted, never named — repository
      setups, tool grants and token pins.
- [x] Admin tool revoke and device unpair have the own-revoke effects (tokens
      refused on the next real request, sessions ended, offers closed;
      unpair revokes every tool on the device and cancels its pairing), plus
      `revoked_by` and one notice; idempotent.
- [x] An admin on the owner's setup gets `403 not_for_owner`; the owner may
      act on an admin's.
- [x] The existing admin token revoke writes a `token_revoked` notice.
- [x] A deactivated member is still readable and revocable.
- [x] `/devices` and `/agents` keep `404` for another owner's rows.
- [x] The owner guard and the secret and hidden-space redactions are
      mutation-checked.

## Builder's notes

- **Deviations from plan §2.4.** No server-side `attention` list (T8's
  `developer-setup-derive.ts` derives it from the checks served); no
  `helper_updated` activity (only the newest client report is stored, so
  there is no update history to derive it from); no
  `tokens.revoked_by_user_id` (a token's revoker is its `token.revoked`
  row's actor, which the activity list reads); no
  `web/src/api/developer-setup.ts` (the dispatch kept `server/web/` to the
  two named crossings — LAI-1140 adds the client types). A device's own
  `helper_version` / `update_available` is likewise left to T8, from the
  tools' `client_report`.
- **Devices** in the answer carry `agent_ids`, not nested tools: every tool
  is once in `tools`, with its checks, so redaction has one place to happen.
- **Hidden spaces**: beyond repositories, a tool's grants and a token's
  project pins to a space the reader cannot open are dropped and counted
  (`grants_hidden`, `project_ids_hidden`) — an id is a name for D-132 item 5.
- **Self is refused on the revokes too** (`422 use_developer_access`), as on
  the read; a person revokes their own on Developer access.
- The existing admin token revoke (`DELETE /users/:id/tokens/:tokenId`) was
  given the notice only; it still has no owner guard, as before (D-133 names
  tools and devices).
