---
id: LAI-757
title: 'Local activity: automated sessions never count, and a one-time 12-month look-back of pushed commits (plugin/ + cli/ + server/ + docs/)'
area: cli
assignee: chief
priority: p1
depends-on: [LAI-751, LAI-752]
discovered-from:
started: 2026-10-15T23:58:27Z
status: done
finished: 2026-10-16T00:36:03Z
---

## Goal

**Made on the owner's direct instruction** (Pawan Sirsat, 2026-10-16, through
the orchestrator), single-agent mode, on the temporary branch
`build-activity-backfill` cut from `master` `3813ead`. Board card LAIKA-563.
One branch changes `plugin/`, `cli/`, `server/` (not `server/web/`) and
`docs/` together. Not pushed, not merged: the orchestrator reviews and merges.

The owner turned local activity on (LAI-751, LAI-752, D-079) and found two
problems. Claude Code sessions that Omnigent launches on the same Mac, under
the owner's account, would count as the owner's prompts and sessions. And
pushed commits only count from the moment sharing was switched on, so the
GitHub row starts empty where the owner wants a GitHub-like twelve months.

## Acceptance criteria

**Part 1 — automated sessions do not count**

- [x] `plugin/scripts/laika-activity-hook` is a complete no-op when any of
      `OMNIGENT=1`, a non-empty `CI` or a non-empty `LAIKA_ACTIVITY_SKIP` is
      set: nothing written under `~/.laika/activity`, nothing printed, exit 0,
      stdin still drained, no fork under zsh, decided before `state.json` is
      read. A skipped session start registers no repo and starts no sync.
- [x] `laika activity status` and the output of `laika activity on` name the
      skip rules in one line.
- [x] Tests: each marker → no event, no output, exit 0, no repo, no sync
      launched; none set → counted as before; the prompt path's timing test
      still holds.

**Part 2 — a one-time look-back of up to 365 days of pushed commits**

- [x] `laika activity backfill [--days N] [--yes] [<repo path>…]` (N default
      365, at most 365) counts the developer's own pushed commits per day in
      the repos the collector knows plus any paths given, by the same rules as
      the pushed-commit count (author email, `laika activity emails` extras,
      `.mailmap` ignored, merges not counted), prints a summary (commits, days,
      per month), asks y/N unless `--yes`, and sends one-way keys per day
      through `PUT /api/v1/me/local-activity` — never commit ids, messages,
      paths, repo names or emails.
- [x] It takes the single-sync lock, stays inside the 2-minute limit, and
      chunks: reports at most the server's per-request cap, a bounded number
      per run, the rest continued by later syncs.
- [x] Automatic: a repo seen for the first time gets its 365-day look-back once,
      in the background sync after the snapshot — never on the prompt path —
      and is recorded so it never repeats.
- [x] Idempotent: a second backfill changes nothing on the server, and a
      commit that was counted local and later pushed is not counted twice.
- [x] Server: `PUT /me/local-activity` accepts pushed-commit keys for days back
      to the 400-day retention window in a look-back report, with a bounded
      payload; beyond retention is refused with the existing
      `day_out_of_range` shape; the report bucket is unchanged and a backfill
      does not trip it. No destructive DB change. Tests for old days accepted,
      beyond retention refused, the payload cap and idempotency.
- [x] Measured: a 20,000-commit repo's look-back on the CLI side (target under
      ~2 s), and the server PUT for a full year against the existing ingest
      latency target.

**Docs and gate**

- [x] D-080 appended to `docs/DECISIONS.md` (D-079 untouched); SPEC's local
      activity sections and the collector's commands match; `cli/README.md`
      and `plugin/README.md` updated. No comment claims more than its code or
      test proves.
- [x] Each new test shown failing before its fix. `pnpm test`, `pnpm lint`,
      `pnpm format` each exit 0, run separately after the last edit.

## Notes / context

- No new dependencies.
- LAI-751 (server, SPEC, D-079) and LAI-752 (collector) are in `done/`.

## Build notes

Commits on `build-activity-backfill` (from `master` `3813ead`): `77550cd`
claim · `9f31048` hook skip + `on`/`status` line · `74d7a0c` server look-back
· `9f6a8ab` collector look-back · `febee21` D-080, SPEC, READMEs · `e46e367`
the soft-stop test anchored to the soft stop (the first gate run had the
snapshot alone outlast a 2 s deadline under load ~10).

**Part 1.** `plugin/scripts/laika-activity-hook` drains stdin first, then
exits 0 when `OMNIGENT` is `1`, `CI` is non-empty or `LAIKA_ACTIVITY_SKIP` is
non-empty — before `state.json` is read, so no event, no repo and no sync.
`OMNIGENT=1` was confirmed in this very session's environment. `on` and
`status` print the rule (`SKIP_RULE`, `cli/src/activity.ts`).

**Server.** `PUT /me/local-activity` with `"lookback": true`
(`recordLookback`, `services/local-activity.ts`): days `{ day, pushed_keys }`
only (at least one key), each once, within today − 400 to today + 1 in `tz`;
no snapshot row; keys upserted at their earliest day. Same 16 KB body limit,
same bucket. The key upsert is now one prepared statement run per key, for
snapshots too. No schema change.

**Collector.** `cli/src/activity-lookback.ts` (records, job, chunking, the
step), `countLookback` in `activity-census.ts`, `backfill` in `activity.ts`,
and the step after the snapshot in `activity-sync.ts` under the same lock and
deadline, stopping new reports at 75 % of it. `lookback.json` (0600) holds per
repo (by common git dir) when it was first seen and when its look-back
finished, the job under way with its day cursor, the pacing time, and the
first `since`. Paths, never emails or SHAs.

**Decisions.**
- *Which commits are the look-back's.* Only those no snapshot can count:
  authored before `since`, or on a day before the first snapshot window of
  that repo (its first sight). Everything else is the snapshot's. This is
  what makes "counted local, pushed later" impossible to double count —
  rejected: correcting old snapshot rows' `commits_local` from the look-back
  (a server partial update keyed on collector, wrong whenever a repo was
  forgotten or the collector rotated).
- *Repos known before the first look-back* are taken as counted since
  `since` (conservative).
- *Body limit kept at 16 KB* rather than raised: measured, a 64 KB look-back
  report of new keys was p95 56 ms (36 ms with the prepared statement), 32 KB
  p95 20.1 ms, 24 KB 15.3 ms, 16 KB 11.4 ms; the ingest target is 20 ms.
- *Pacing*: ≤ 4 look-back reports a run, then `(n + 1) × 120 s` before the
  next — with ≤ 1 snapshot per 600 s that is at most the bucket's refill.
- *Dropped* the sent-memory skip and the 2000-keys-a-day cap from the
  look-back census: a resent key changes nothing on the board, and reports
  split a large day anyway; neither rule could be reached by a test.
- A refused look-back (422: an older board) is asked again a day later, not
  every sync.

**Red first.** Part 1's 4 new hook tests and the skip-line test, and the
server's 11 new tests, were run red before their code; the collector's 15
first tests red before the module existed. Then a mutation run (anchor must
match once, the named test run unmutated first, restore checked by sha256):
**29 of 29 red** — the census's ownership rule, cross-clone rule, emails,
window, merges, authorship, `%ae`; the reports' 16 KB budget and split-day
cursor; ≤ 4 a run, the pause, the done record, first-sight dating, the
one-day wait, 403 stop, the soft stop, the automatic job, ask-first, the
lock; the hook's three markers, drain-before-skip and no-sync; the status
line; server 400 days, the `lookback` dispatch, earliest day, no snapshot
row. `M16` (soft stop) re-run red after the test was re-anchored.

**One existing test changed**: `activity-sync.test.ts`, the 403 resume test
now expects `GET, PUT, PUT lookback` after re-enable — the repo's look-back
had never run, which is D-080's behaviour.

## Evidence

- Gate after the last edit, from the worktree root, each on its own:
  `pnpm test > /tmp/lai757-test.txt 2>&1; echo TEST $?` → `TEST 0` (server
  123 files / 2544 tests, web 1969, cli 312 test cases);
  `pnpm lint` → `LINT 0`; `pnpm format` → `FMT 0`.
- Prompt path: fastest 3.38 ms (bare 2.44) quiet; 6.88 ms (bare 4.02) inside
  the gate at load ~10 — the test's ≤ 2× bare rule.
- Look-back census of a 20,000-commit repo (all the developer's, fast-import):
  1119–1272 ms at load ~4 (four runs), 1962 ms inside the gate at load ~10.
  Delivered against the stub's real bucket in 25 reports over 7 syncs, no 429.
- Server, through the HTTP route, 204,000 keys held, 25 runs each:
  a full 16 KB look-back report of new keys p50 4.5 / p95 11.4 ms; all keys
  already held p50 2.6 / p95 3.0 ms; a realistic year (2,500 commits on 250
  days) = 4 reports, p50 28 / p95 32 ms summed; a 14-day snapshot p50 1.1 /
  p95 2.3 ms.
- Accepted day range, before: every report today − 14 … today + 1, ≤ 14 days.
  After: a snapshot unchanged; a look-back today − 400 … today + 1.

## Not verified

- Against the owner's real machine and the production board: everything ran
  against temporary repos, a stub board and the server's own test harness.
- The look-back's double-count rule assumes one clone per repo per machine; a
  commit counted local in one clone and seen pushed in a different clone not
  in the same census (a later auto job for that clone only) can still be
  counted twice. Recorded here, not in D-080's guarantees.

## Review round 1

One blocking and two small findings, all fixed in `a74cd9ea`; criteria frozen
and unchanged.

1. **Blocking — a no to `backfill` was not a no.** `planBackfill` recorded the
   repos without `done_at`, so the next background sync's automatic look-back
   sent exactly the declined commits. Now a no marks every repo in the plan
   `declined_at` (paths given by hand too), drops any look-back under way,
   and prints *"The automatic look-back will not send these either; run
   `laika activity backfill` again to send them."* The automatic job skips
   declined repos. A later `backfill` answered yes sends; a full year, once
   finished, writes the record without the decline. A narrower yes (`--days`
   under 365) sends its window and leaves the automatic look-back off — the
   developer never agreed to the year.
2. **A git failure marked a repo done for good.** `countLookback` now reports
   repos whose `log --remotes` gave no answer (`unread`; a repo without a
   remote answers an empty log, exit 0, and is not one). They are not marked
   done, the error goes to last-error, and the next try waits the interval,
   doubling, at most 6 h (`failures` in lookback.json, reset on a clean run).
3. **The hook test claimed more than it proved.** The empty-PATH test is now
   *"drains stdin with builtins"*. A new test puts stubs for `date`, `cat`,
   `git`, `awk`, `mv`, `rm`, `nohup` and `dirname` on PATH that log their
   own name: under zsh each skip marker logs none, and the same probe with no
   marker logs `git` (positive control). A command run by absolute path is
   outside what it sees, and the comment says so.

**Red first.** The reviewer's scenario (answer n → no report; an hour later
`sync()`) was red before the fix with *"a sync sent what was declined"*; the
git-failure test red (no error recorded, repo marked done). *Declined, then
`backfill --yes`* passed before and after, as it must. Then 9 of 9 mutations
red: the decline recorded, skipped by the automatic job, kept by a narrower
yes, stopping a job under way; `unread` detected, not marked done, the
doubling, the error recorded; a `date` call in the hook's skip path caught by
the stub probe.

## Accepted

2026-10-16 — accepted by chief (polly) on the owner's direct instruction. One review round (Claude): one blocking consent bug (a declined backfill was still sent by the automatic look-back) fixed in a74cd9e with the reviewer's scenario as a red-then-green test; git-failure retry and the hook test wording fixed too. Targeted cli tests 86/86 on dd4548d; builder's full gate TEST 0 / LINT 0 / FMT 0 on the final tree. Board card LAIKA-563.
