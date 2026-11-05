---
id: LAI-1143
title: "An admin cannot revoke the owner's tokens; LAI-1137's test and comment follow-ups"
area: core
assignee: core
priority: p1
depends-on: []
discovered-from: LAI-1137
status: review
started: 2026-11-05T12:19:28Z
finished: 2026-11-05T12:30:35Z
---

Board: LAIKA-1006, a subtask of LAIKA-997. Filed from CHIEF's block by polly's dispatched
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

- [x] `token.revoke_any` checks the target's org role in `can()` the way
      `agent.revoke_any` does: an admin is refused the owner's, and a non-owner
      caller with no target role loaded is refused.
- [x] `revokeTokenFor` passes `targetOrgRole` and answers an admin on the
      owner's token `403` with `details.reason: not_for_owner`.
- [x] Tests assert status and code for: an admin on the owner's personal token,
      an admin on the owner's tool token, the owner on an admin's token, an
      admin on a member's token.
- [x] SPEC §3.1 and §6.4 say it; `policy-spec-drift` verifies the new
      qualifier.
- [x] `developer-setup.test.ts` asserts `204` on the second DELETE and on the
      admin revoking their own token.
- [x] The comment in `revokeTokenFor` points at `writeNotice` for the
      own-revoke rule.
- [x] Mutation evidence for the new token guard, the existing agent/device
      owner guard, and the `toolView` grant redaction: each broken, the single
      file run, the named test red, restore checksummed. Table below and in the
      log.
- [x] A backlog task is filed for a member's own unpair leaving the device
      active (`revokeOwnAgentDevice`).
- [x] Every test file touching tokens, policy or the guards green one by one;
      `pnpm lint`, `pnpm format`, server and web typechecks exit 0.

## Mutation evidence

Harness: the anchor must match exactly once or it prints `ANCHOR FAILED`
and stops; the file's sha256 is printed before and after the mutation; the
restore runs in an `EXIT INT TERM` trap that `cd`s to the worktree root,
copies the backup back, and checks the sha256 against the original **and**
`git hash-object` against `HEAD`'s blob. One test file per run,
`npx vitest run <file> --maxWorkers=1` from `server/`.

| # | Mutation | File run | Exit | Went red | Failure | Restore |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | `can.ts` `token.revoke_any`: `… && targetOrgRole !== 'owner'` dropped (admin may revoke the owner's) | `test/http/routes/tokens.test.ts` | 1 | *refuses an Admin the owner's personal token…*, *…the owner's tool credential…*, *…even once it is revoked* (3 of 29) | `expected 204 to be 403` ×3 | sha256 `c751dcc9…` = HEAD blob `bcc74599` |
| M2 | `tokens.ts` `revokeTokenFor`: the guard asks about a member instead of the holder's role | `test/http/routes/tokens.test.ts` | 1 | the same three (3 of 29) | `expected 204 to be 403` ×3 | sha256 `a6b2ba51…` = HEAD blob `bd47da2f` |
| M3 | `can.ts` `agent.revoke_any`/`device.revoke_any`: `return orgRole === 'owner' \|\| targetOrgRole !== 'owner'` → `return true` | `test/http/routes/developer-setup.test.ts` | 1 | *an admin may not revoke the owner's tool; the owner may revoke an admin's*, *an admin may not unpair the owner's device*, *an admin is told it cannot revoke on the owner's setup* (3 of 23) | `expected 200 to be 403` ×2, `expected true to be false` (`can_revoke`) | sha256 `c751dcc9…` = HEAD blob `bcc74599` |
| M4 | `developer-setup.ts` `toolView`: `view.grants.filter(readable…)` → `view.grants` | `test/http/routes/developer-setup.test.ts` | 1 | *a space the reader cannot open is counted, never named — repositories, grants and pins* (1 of 23) | `response names the hidden space by <id>` | sha256 `e3dfa469…` = HEAD blob `7e86baf3` |

A first M1 attempt passed relative anchor paths after the harness `cd`'d
away: it printed `ANCHOR FAILED`, never mutated, and the trap's restore check
still confirmed the HEAD blob. After the four runs `git status --porcelain`
was empty and both files ran green again (29/29, 23/23).
