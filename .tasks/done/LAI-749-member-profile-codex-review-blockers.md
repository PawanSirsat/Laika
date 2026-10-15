---
id: LAI-749
title: 'Member profile: three blockers from the Codex review — trigger verifier, rating attempt scope, slow structural test'
area: server
assignee: chief
priority: p1
depends-on: [LAI-746]
discovered-from: LAI-746
started: 2026-10-15T09:26:28Z
status: done
finished: 2026-10-15T09:38:52Z
---

## Goal

**Made on the owner's direct instruction** (2026-10-15, through the
orchestrator), single-agent mode (`docs/HANDOVER.md` §4), on
`build-profile-v1` after `c9a3e0f`. An independent review of
`e45a2f9...c9a3e0f` returned CHANGES REQUIRED with three blocking findings;
LAI-743 and LAI-746 are in review with frozen criteria, so the fixes are this
task. Nothing else changes.

## Acceptance criteria

- [x] **1. The boot step verifies what a trigger does, not a substring.**
      `ensureActivityTriggers` rejects a trigger that holds the right name and
      the right message text but does not abort — for
      `member_ratings_is_append_only_no_replace` and every other append-only
      trigger it keeps. A test installs such a trigger (message text kept,
      effect removed) and must see it refused; shown red before the fix. The
      comments say what the check actually checks.
- [x] **2. A rating attempt belongs to one member.** The key is reused only
      for the same member, score and note: failed save → close → another
      member's profile without unmounting → same score and note → a new key,
      not a `409`. A browser test drives exactly that sequence; shown red
      before the fix.
- [x] **3. The structural privacy test reads each file once**, without a
      synchronous double walk, and stays exactly as strict; not by raising a
      timeout. Shown slow or failing before.
- [x] Gate after the last edit: `pnpm test`, `pnpm lint`, `pnpm format` each
      exit 0 from the worktree root.

## Notes / context

- Findings: `server/src/db/migrate.ts` (~129, ~172) and
  `server/test/db/migrate.test.ts` (~542); `profile-derive.ts` (~71) and
  `ProfileScreen.tsx` (~99, ~203); `server/test/services/profiles.test.ts`
  (~623). D-055: flakes are defects.

## Build notes

On top of LAI-746's `c9a3e0f`, which is unchanged. Commits: `c5eead2` claim ·
`83cf1da` (1) · `f727035` (2) · `f1340b1` (3).

**1. Trigger verifier.** The boot step now compares each append-only trigger's
stored SQL with the definition it creates, normalised for case, whitespace,
quoting, `IF NOT EXISTS` and a trailing `;` — not a search for its message.
Every trigger body any migration has written (`0000`, `0003`, `0004`, `0005`,
`0008` for `activity`; `0029`, `0030` for `member_ratings`) was checked to
normalise to exactly one definition, so no existing database is refused. A
behavioural probe was weighed and not taken: it needs throwaway rows and a
rollback inside boot, and a trigger that fires only for the probe's values
would fool it. Two tests install a substitute that keeps the name and the
message text: `activity`'s no-update as a bare `SELECT '<message>'`, and
`member_ratings`' no-replace with `WHEN 0`. Each first shows the substitute
lets the write through (an UPDATE rewrites a row; a replace turns score 5 into
1), then expects boot to refuse it. Red first, both with *"expected [Function]
to throw an error"*. After: all 159 tests in `test/db` pass. The docblock and
`migrations/README.md` now say the step checks the whole definition.

**2. Rating attempt scope.** `RatingAttempt` carries `userId`, and
`nextAttempt` reuses a key only for the same member, score and trimmed note.
The screen keeps one attempt per member (a `Map` keyed by id), so going back
to a member still retries with their key. A new browser test fails Bea's save,
closes the dialog, moves to Cal through `pushState` and `popstate` without
unmounting, sends the same score and note, and compares the two
`Idempotency-Key` headers. Red first (*"Cal's rating reused Bea's attempt
key"*), green after (20/20 in `member-profile`). A unit test pins the same
rule. With `userId` dropped from the equality, that unit test goes red.

**3. Structural test.** Before, counted from the old code in a scratch copy:
108 files, **216 `readFileSync` and 186 `statSync`**, all synchronous. Now:
one recursive `readdir`, each file read once and concurrently, and both
questions asked of that one `Map`. Still exactly as strict:
- the file set is identical (108 each way, compared by script);
- the two assertions, the regexes and the import resolution are unchanged;
- a second module naming the table goes red, and so does a second module
  importing the service (both checked by mutation, restored by trap).

A new test pins "once each" through an injectable counting reader. With every
file read twice, it goes red with *"expected [ 2, 2, 2, … ] to deeply equal
[]"*. No timeout was raised.

Measured alone, interleaved six times each, at load average ≈ 22–27: old
62–114 ms, new 50–80 ms. The gain alone is small. Under load the old version
blocked the worker on 402 synchronous calls, and the new one makes 108 reads
that the thread pool overlaps.

## Accepted

2026-10-15, by polly (orchestrator), on the owner's direct instruction. Same-vendor review of c9a3e0f...71b033f: APPROVE, no blockers. Fixes 1 and 2 were each reverted in a throwaway copy and their tests went red; fix 1 verified against every trigger body any migration has written, at every migration step 0000-0030. Non-blocking follow-ups (per-member attempt store untested in the browser, two comments that overclaim, a hand-edited production trigger would now refuse boot, fix 3's gain is about 25-30%) are recorded in logs/chief-2026-10-15.md for a later task.
