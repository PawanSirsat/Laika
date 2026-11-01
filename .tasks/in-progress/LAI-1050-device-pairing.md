---
id: LAI-1050
title: 'Developer access V3 slice C1: secure device pairing (server)'
area: server
assignee: core
priority: p1
depends-on: [LAI-1045]
started: 2026-11-02T12:00:00+05:30
status: in-progress
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
- [x] CI is green on the PR (#205, run 41355720184 on 382f01e7).

## Dependencies

LAI-1045 (PR #202, in review). This branch is stacked on it.

## Review notes (PR #205, round 1) — sent back

Received from the reviewer through the dispatch, and fixed in new commits:

- **B1 (blocking, DoS).** `pairing:claim` and `pairing:failures` were single
  global buckets. A 404 on complete was charged to the shared failure key, so
  roughly one anonymous request a second to `/device-pairing/<random>/complete`
  locked pairing out for the whole board. The fix:
  - complete neither checks nor spends the shared key;
  - the claim backoff is sized against the code's entropy, and the claim bucket
    raised to match;
  - the test that enshrined the lockout is replaced by one proving a flood of
    bogus completes does not block a real pairing;
  - SPEC §6.3's numbers are updated.
- **B2 (blocking, memory).** `classify` keyed `pairing:complete:<rest of
  path>` from attacker input. The fix:
  - only a ULID-shaped `/<id>/complete` gets its own key; anything else shares
    one fixed key;
  - the limiter's map is bounded: a cap, with refilled buckets pruned first and
    the least recently used evicted after;
  - a test shows 1,000 distinct paths leave it bounded.
- **The concurrent-claim test could not fail** on the `state = 'open'` guard.
  It now exercises the guard directly, and deleting the condition makes it go
  red.
- **N1.** One public key is never on two devices: a partial unique index on
  `devices.public_key`, plus a re-check at completion.
- **N2.** Creating or completing a pairing is refused while
  `LAIKA_PUBLIC_URL` is unset.
- **N4.** SPEC says that anyone holding a request's id can cancel it with five
  bad signatures.
- **N3** (HMAC the code hash) is filed as a follow-up, not done here.
- **`can()`:** CHIEF records the exception for the two device-side routes as
  D-124, in a separate docs PR. No `can()` is added here.

## UX contract for slices C3 (CLI) and D4 (browser)

Recorded at the reviewer's request; the server serves what these need.

- **The CLI computes and prints the key's fingerprint locally**, before it
  claims: the first 16 hex characters of the sha256 of its SPKI DER, the same
  rule as `keyFingerprint`. The user can then compare it with the browser
  without trusting the server's answer.
- **On `409 pairing_already_claimed`**, the CLI tells the user that another
  device claimed this code, that they should **deny it in the browser**, and
  that they should start again.
- **The browser shows the fingerprint, the OS, the CLI version and the claim
  time** for a claimed request, with the words *"Approve only if this matches
  your terminal."* It sends back the fingerprint it showed when approving or
  denying.
