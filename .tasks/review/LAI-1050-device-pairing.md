---
id: LAI-1050
title: 'Developer access V3 slice C1: secure device pairing (server)'
area: server
assignee: core
priority: p1
depends-on: [LAI-1045]
started: 2026-11-02T12:00:00+05:30
status: review
finished: 2026-11-02T13:05:00+05:30
---

Slice C1 of the plan `docs/proposals/LAI-1042-developer-access-v3-plan.md`
(§D.2 table 3, §E.1 pairing, §E.8, §J slice C1, §K "Pairing security",
§L4, §L5). A device proves it holds a private key, and the owner approves
it in the browser. **Pairing mints no credential.**

**The id deviates from the brief.** The dispatch named LAI-1049. That id is
already taken on `LAI-1046-token-kind`, by
`.tasks/backlog/LAI-1049-agent-token-lists-only-itself.md`, so this task is
LAI-1050: the next number free across every branch and on the board.

**No commit carries the stale id.** The branch was renamed from
`LAI-1049-device-pairing` before its first push, and every commit says
`[LAI-1050]`. Only the temporary worktree's directory, `.polly/wt-1049`, keeps
the old number.

**The dependency deviates from the claim rule too.** LAI-1045 (PR #202) is in
review and not yet in `done/`. The owner's dispatch stacks this branch on it
explicitly, and the PR targets `LAI-1045-devices-migration` until #202 merges.

## Scope (CORE, `server/` except `server/web/`)

- Migration `0071` (next after `0070`): the table `device_pairing_requests`.
  It stores the **sha256 of the code, never the code itself**, plus the owner
  and org binding, an optional existing `device_id`, kind and name, state,
  expiry, the claimed public key and fingerprint, the challenge nonce, and
  failed attempts. Additive only.
- Routes for §E.1:
  - session-only create, read, approve, deny and cancel
    (`agent.manage_own` / `agent.read_own`);
  - anonymous `claim`, and `complete` by Ed25519 proof of possession.
- `LIMITS.pairing`: its own bucket, not the shared anonymous one.
- Node built-in `crypto` only. No new dependency.
- The exchange, client-report and repo-setup tables (§D.2 tables 4–6) are
  slice C2's.

## Named cross-area edits (D-033)

- `docs/SPEC.md`: a new §4.79 `device_pairing_requests`, the §E.1 endpoint
  lines in §6.4, and one paragraph in §6.3's rate limits for pairing's
  buckets.
- `server/web/test/api/endpoint-coverage.test.ts`: `NO_BROWSER_CALLER`
  entries for the new paths, naming the V3 pairing screen (slice D) as the
  caller to come. This is the LAI-1045 precedent.

## Acceptance criteria

- [x] `0071` adds `device_pairing_requests` and rebuilds no table. Only the
      code's hash is stored.
- [x] Create is browser-session only and owner-bound. It returns a code of
      about 8 characters, valid for 10 minutes. There are at most 5 open
      requests per owner.
- [x] A device claims once, with a fresh Ed25519 public key. Claim is
      unauthenticated and rate-limited in its own bucket.
- [x] Unknown, malformed, expired and finished codes answer byte-identical
      `404`s. A code still live but claimed already is `409`
      `pairing_already_claimed`, as plan §E.1 says, so the real device learns
      it was raced.
- [x] Of two concurrent claims, exactly one wins.
- [x] The browser sees the fingerprint. Approve requires the fingerprint it
      saw: a mismatch is `409`. Deny is terminal.
- [x] Complete verifies the signature over the server's nonce:
      - before approval it is `202`;
      - a wrong signature is `401`;
      - a replay is `409`.
- [x] The result is a new paired device, or the key attached to the owner's
      existing imported device, when the browser chose that explicitly.
- [x] A test asserts that the `tokens` row count is unchanged through the
      whole pairing.
- [x] Another owner's request is a byte-identical `404`.
- [x] Token actors are refused with `session_required`.
- [x] Brute force reaches `429` with `Retry-After`.
- [x] No new activity verb and no new §3.1 action.
- [x] SPEC rows are written.
- [ ] CI is green on the PR.

## Dependencies

LAI-1045 (PR #202, in review). This branch is stacked on it.
