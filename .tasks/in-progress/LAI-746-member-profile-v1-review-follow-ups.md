---
id: LAI-746
title: 'Member profile v1: review follow-ups — idempotency replay, INSERT OR REPLACE, updated_at, missing tests, dialog retries, list caps'
area: server
assignee: chief
priority: p1
depends-on: [LAI-743]
discovered-from: LAI-743
started: 2026-10-15T07:35:00Z
status: in-progress
---

## Goal

**Made on the owner's direct instruction** (2026-10-15, through the
orchestrator), single-agent mode (`docs/HANDOVER.md` §4): `server/`,
`server/web/` and `docs/` in one branch, on top of LAI-743's `5472712`,
which stays as it is. LAI-743's review approved it with no blockers and listed
these follow-ups; LAI-743's criteria are frozen, so they are this task.

## Acceptance criteria

- [ ] **1. Idempotency cannot replay a profile write to a token.** A token
      sending a `POST /users/:id/ratings` with the `Idempotency-Key` a session
      used gets `403 forbidden`, never the stored `201`; and the rating's note
      is not stored in `idempotency_keys.response_body` for the profile
      routes. D-078 item 3 and SPEC §4.21 say only what is true afterwards.
- [ ] **2. `INSERT OR REPLACE` cannot rewrite a rating.** A replace on an
      existing `member_ratings.id` aborts, and the boot-time trigger step keeps
      covering the new trigger. `activity`'s identical hole is filed as its own
      task, not changed here.
- [ ] **3. Setting a profile kind does not touch `users.updated_at`**, and a
      member reading `/users?updated_since=` sees no change from it.
- [ ] **4. The four mutations the review's tests survived are now killed**:
      a same-category Done → Done move is not an acceptance (M2); online
      agents are this person's only (M8); weeks bucket by `floor` (M18); a
      project reached only through review decisions appears (M19). Each new
      test shown red under its mutation, restored in a trap.
- [ ] **5. The rating dialog** sends an `Idempotency-Key` per submit attempt,
      the same on a retry of that attempt, and Escape or close does not
      discard a save in flight.
- [ ] **6. Long lists are capped**: `current_work`, `ratings` and the agent
      tokens carry at most 50 entries plus a total, and the screen says
      "and N more". Tested on both sides.
- [ ] **7. (If cheap)** the `0028` upgrade test carries accounts, sessions and
      tokens through `0029`.
- [ ] Not changed, by the owner's decision: validation before permission, the
      current-assignee rule, who may read ratings.
- [ ] Gate — `pnpm test`, `pnpm lint`, `pnpm format` — each exits 0 from the
      worktree root after the last edit. Affected screenshots retaken in
      `/tmp/laika-profile-v1-shots/`.

## Notes / context

- Branch `build-profile-v1`, worktree `Laika-profile-v1/`. Never amend or
  rewrite `5472712` or anything before it; the owner may push it alone.
- Migration `0029` has not been deployed anywhere, so it may be amended if
  drizzle's journal and snapshot stay consistent; otherwise `0030`.
