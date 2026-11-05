---
id: LAI-1137
title: 'Developer setup read for owners and admins; admin revoke of a tool and device unpair'
area: server
assignee: core/belka
priority: p2
depends-on: [LAI-1136]
status: in-progress
started: 2026-11-05T16:52:00+05:30
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

- [ ] `GET /people/:id/developer-setup`: a member, viewer, space admin or any
      token is refused `403` (a token `session_required`); yourself is
      `422 use_developer_access`; an unknown id is `404` to a holder.
- [ ] Every read writes one `developer_setup` look, deduped inside ten
      minutes; a refused read writes none.
- [ ] No pairing code, code hash, token secret or token hash is in the
      response (asserted by searching the JSON for the stored values).
- [ ] A space the reader cannot open is counted, never named — repository
      setups, tool grants and token pins.
- [ ] Admin tool revoke and device unpair have the own-revoke effects (tokens
      refused on the next real request, sessions ended, offers closed;
      unpair revokes every tool on the device and cancels its pairing), plus
      `revoked_by` and one notice; idempotent.
- [ ] An admin on the owner's setup gets `403 not_for_owner`; the owner may
      act on an admin's.
- [ ] The existing admin token revoke writes a `token_revoked` notice.
- [ ] A deactivated member is still readable and revocable.
- [ ] `/devices` and `/agents` keep `404` for another owner's rows.
- [ ] The owner guard and the secret and hidden-space redactions are
      mutation-checked.
