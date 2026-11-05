---
id: LAI-1143
title: "An admin cannot revoke the owner's tokens; LAI-1137's test and comment follow-ups"
area: core
assignee: core
priority: p1
depends-on: []
discovered-from: LAI-1137
status: in-progress
started: 2026-11-05T12:19:28Z
---

Board: a subtask of LAIKA-997. Filed from CHIEF's block by polly's dispatched
builder and claimed in the same commit.

## Goal

`DELETE /api/v1/users/:id/tokens/:tokenId` asks only for `token.revoke_any`
(`server/src/services/tokens.ts`, `revokeTokenFor`), so an admin can revoke
the owner's tool-credential tokens and switch the owner's tools off. D-133 says
an admin may not act on the owner's setup. Applying D-133 (polly's decision):
the guard covers **every** token the owner holds, personal tokens and tool
credentials alike.

## Scope

- `server/src/policy/can.ts`, `server/src/services/tokens.ts`,
  `server/src/services/permissions.ts`.
- Tests under `server/test/` for tokens, policy and the guards.
- Named cross-area edit (D-033): **SPEC §3.1**, the row *List / revoke
  anyone's token*, split into a list row and a revoke row so the revoke row can
  say *not for the owner*; and **SPEC §6.4**'s line for
  `DELETE /users/:id/tokens/:tokenId`. Nothing else in `docs/`.

## Acceptance criteria

- [ ] `token.revoke_any` checks the target's org role in `can()` the way
      `agent.revoke_any` does: an admin is refused the owner's, and a non-owner
      caller with no target role loaded is refused.
- [ ] `revokeTokenFor` passes `targetOrgRole` and answers an admin on the
      owner's token `403` with `details.reason: not_for_owner`.
- [ ] Tests assert status and code for: an admin on the owner's personal token,
      an admin on the owner's tool token, the owner on an admin's token, an
      admin on a member's token.
- [ ] SPEC §3.1 and §6.4 say it; `policy-spec-drift` verifies the new
      qualifier.
- [ ] `developer-setup.test.ts` asserts `204` on the second DELETE and on the
      admin revoking their own token.
- [ ] The comment in `revokeTokenFor` points at `writeNotice` for the
      own-revoke rule.
- [ ] Mutation evidence for the new token guard, the existing agent/device
      owner guard, and the `toolView` grant redaction: each broken, the single
      file run, the named test red, restore checksummed. Table below and in the
      log.
- [ ] A backlog task is filed for a member's own unpair leaving the device
      active (`revokeOwnAgentDevice`).
- [ ] Every test file touching tokens, policy or the guards green one by one;
      `pnpm lint`, `pnpm format`, server and web typechecks exit 0.

## Mutation evidence

(filled in when run)
