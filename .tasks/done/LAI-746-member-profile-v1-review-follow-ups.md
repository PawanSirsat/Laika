---
id: LAI-746
title: 'Member profile v1: review follow-ups — idempotency replay, INSERT OR REPLACE, updated_at, missing tests, dialog retries, list caps'
area: server
assignee: chief
priority: p1
depends-on: [LAI-743]
discovered-from: LAI-743
started: 2026-10-15T07:35:00Z
finished: 2026-10-15T07:59:49Z
status: done
---

## Goal

**Made on the owner's direct instruction** (2026-10-15, through the
orchestrator), single-agent mode (`docs/HANDOVER.md` §4): `server/`,
`server/web/` and `docs/` in one branch, on top of LAI-743's `5472712`,
which stays as it is. LAI-743's review approved it with no blockers and listed
these follow-ups; LAI-743's criteria are frozen, so they are this task.

## Acceptance criteria

- [x] **1. Idempotency cannot replay a profile write to a token.** A token
      sending a `POST /users/:id/ratings` with the `Idempotency-Key` a session
      used gets `403 forbidden`, never the stored `201`; and the rating's note
      is not stored in `idempotency_keys.response_body` for the profile
      routes. D-078 item 3 and SPEC §4.21 say only what is true afterwards.
- [x] **2. `INSERT OR REPLACE` cannot rewrite a rating.** A replace on an
      existing `member_ratings.id` aborts, and the boot-time trigger step keeps
      covering the new trigger. `activity`'s identical hole is filed as its own
      task, not changed here.
- [x] **3. Setting a profile kind does not touch `users.updated_at`**, and a
      member reading `/users?updated_since=` sees no change from it.
- [x] **4. The four mutations the review's tests survived are now killed**:
      a same-category Done → Done move is not an acceptance (M2); online
      agents are this person's only (M8); weeks bucket by `floor` (M18); a
      project reached only through review decisions appears (M19). Each new
      test shown red under its mutation, restored in a trap.
- [x] **5. The rating dialog** sends an `Idempotency-Key` per submit attempt,
      the same on a retry of that attempt, and Escape or close does not
      discard a save in flight.
- [x] **6. Long lists are capped**: `current_work`, `ratings` and the agent
      tokens carry at most 50 entries plus a total, and the screen says
      "and N more". Tested on both sides.
- [x] **7. (If cheap)** the `0028` upgrade test carries accounts, sessions and
      tokens through `0029`.
- [x] Not changed, by the owner's decision: validation before permission, the
      current-assignee rule, who may read ratings.
- [x] Gate — `pnpm test`, `pnpm lint`, `pnpm format` — each exits 0 from the
      worktree root after the last edit. Affected screenshots retaken in
      `/tmp/laika-profile-v1-shots/`.

## Notes / context

- Branch `build-profile-v1`, worktree `Laika-profile-v1/`. Never amend or
  rewrite `5472712` or anything before it; the owner may push it alone.
- Migration `0029` has not been deployed anywhere, so it may be amended if
  drizzle's journal and snapshot stay consistent; otherwise `0030`.

## Build notes

On top of LAI-743's `5472712`, which is unchanged. Commits: `45eecaf` claim ·
`a3ae3a6` (4) · `b7877e0` (3) · `2a00b46` (2) · `ebc8b2a` (1) · `28d02b9`
LAI-747/748 · `d14315a` (6) · `bbb6577` (5) · `0db0fce` (7) · `b4b2848`
disabled style for (5).

**1. Idempotency.** The narrower change: the shared store skips
`POST /users/:id/ratings` (`KEYED_BY_THE_ROUTE`), and `rateMember` keeps the key
on the rating (`member_ratings.idempotency_key`, `0030`) and answers a retry
from it after `profile.rate` — so a token is refused whatever key it holds, and
the note is never in `idempotency_keys`. Skipping the store alone would have
left item 5's key meaning nothing; re-keying every route by credential is wider
than asked, and is LAI-748. Keys are per rater and never expire; a different
body is `409`; a key over 255 characters is `400`. Red first: the token got the
stored `201` (`Idempotent-Replay: true`) and the note was in
`idempotency_keys`; then mutations — the middleware not skipping, the service
ignoring the key, no conflict check, the key not scoped by rater — each failed
its test.

**2. `INSERT OR REPLACE`.** A `BEFORE INSERT` trigger aborts when `NEW.id`
exists, in `0030` and in the boot step. **`0030`, not an edited `0029`**: the
owner may push `5472712` alone, which ships `0029`; an edited `0029` would then
either re-run or never apply. Red first on four tests (schema, both trigger
tests, the `0029` → `0030` upgrade); the boot-step test also goes red if the
step forgets the trigger. `activity`'s identical hole was measured and filed as
LAI-747, not changed.

**3.** `setProfileKind` no longer writes `updated_at`. Red first: the member's
`/users?updated_since=` returned the row.

**4.** M2, M8 (both the heartbeat and the `/mcp` filter), M18 and M19 each red
under the review's mutation, restored in a trap. M8's first fixture tied two
sessions at one instant and was corrected before it counted.

**5.** One `Idempotency-Key` per rating attempt (`nextAttempt`): the same on a
retry of the same score and note, new when either changes, dropped once a save
is answered. Keys come from `getRandomValues` — `crypto.randomUUID` does not
exist on plain HTTP, which production is. While a save is in flight, Escape,
the scrim, Cancel and ✕ wait. Red first on both browser tests and both unit
tests; mutations of the reuse rule, the in-flight guard and the generator each
failed their test.

**6.** `PROFILE_LIST_LIMIT` (50) on ratings (newest), current work (oldest
start) and tokens (latest use), beside `ratings_total`, `in_progress_total`,
`in_review_total`, `tokens_total`; the screen counts by totals and adds
*"and N more"*. Red first on both sides; each cap mutated away failed.

**7.** The `0028` upgrade test now carries an account, a session and a token
through `0029` and asserts them unchanged; a migration that drops sessions
fails it.

**Not changed**, by the owner's decision: validation before permission, the
current-assignee rule, who may read ratings. **D-078 item 3 was edited** (not
superseded) because it is unaccepted and the brief asked for it.


## Accepted

2026-10-15, by polly (orchestrator), on the owner's direct instruction. Its builder's final report was lost to an account error; the work (45eecaf..c9a3e0f) was gated afterwards. The independent Codex review of e45a2f9...c9a3e0f found three blockers, all fixed in LAI-749. Released with LAI-743 and LAI-749.
