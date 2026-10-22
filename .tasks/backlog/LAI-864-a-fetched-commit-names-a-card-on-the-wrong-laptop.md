---
id: LAI-864
title: 'Time drafts: a commit this laptop only fetched names a card and counts in its blocks'
area: cli
assignee: strelka
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

Only a commit **made on this laptop** may name a drafted block's card, add to
a block's `commits` count, or appear in its commit times (`at.commits`,
D-096). A commit that arrived by `git fetch`, or by a merge or pull of
someone else's branch, does nothing to this laptop's time.

**What the owner saw (2026-10-22, Belka, IST).** Drafted blocks 12:43–12:45,
12:45–12:50, 12:51–1:06 and 12:51–1:03 AM were tied to LAI-314 and LAI-315.
Those are Strelka's tasks; Belka never worked on them.

## Why (read at `28cf1877`)

- `draftCommits` (`cli/src/activity-time.ts:744-800`) reads every repo the
  hook has seen a session start in. It runs
  `git log --branches --remotes [HEAD] --no-merges … --format=%H%x09%at%x09%ae%x09%s`
  (`:778-787`). `--remotes` walks every `refs/remotes/*`, so a commit that only
  exists on `origin/LAI-314-…` is read. `--branches` also reaches another
  laptop's commits once they are merged into a local branch.
- The only filter is the author email (`:773-776`, `:793`), and both laptops
  commit under the same repo-local email. Nothing tells the two apart.
- A commit names its card from its **subject**, not its branch: the subject
  goes through `textKeys`, and the commit gets a key only if exactly one key
  the board serves is found (`:795-796`).
- `commitKey` (`:364-387`) gives that key to an **untied session minute in the
  same repository** up to `COMMIT_REACH_S` (15 minutes, `:82`) before the
  commit's **author** time (`%at`). It is applied at `:397`. Repositories are
  told apart by their common git dir (`:770-772`), so one fetch in `Laika/`
  covers every worktree.
- The count loop (`:506-520`) does not check the repository at all. Every
  commit within reach of an active minute adds to `signals.commits`, and
  `timeIn(b, 'commits', …)` puts it in `at.commits`. A fetched commit
  therefore counts even when it ties nothing. `read.commits`, printed by
  `laika time draft`, is `commits.length` (`:883`).
- Each sync re-drafts the last 7 days (`DRAFT_DAYS`, `:86`). So a fetch hours
  later re-ties blocks that were already drafted.
- This has existed since the commit rule landed (around 20 Oct). It only shows
  now that two laptops fetch each other's work.
- **Not affected:** the heatmap snapshot's `commits_local` uses
  `--branches --not --remotes` (`cli/src/activity-census.ts:497-505`).
  Pushed commits travel as one-way keys that the server keeps as a set
  (`server/src/services/local-activity.ts:410-425`, SPEC §4.24).

## Acceptance criteria

- [ ] **Measure first, and record it here.** On Strelka, which fetches Belka's
      work the same way, run `laika time draft --days 2`. That command sends
      nothing (`cli/src/activity.ts:1130`). List each block whose key, or
      whose `commits` count, comes from a commit Strelka did not make. Record
      start, end, key and count only, never subjects, paths or branch names.
      If nothing shows, say so and why.
- [ ] **The signal.** Choose how the collector knows a commit was made on this
      laptop, and justify the choice here against the alternatives. Reflog
      `commit:` entries and hashes recorded at commit time are two candidates.
      Whatever you choose:
      - it reads only local files and sends nothing new;
      - it treats `commit (amend)`, `cherry-pick` and `rebase (pick)` as made
        here, and `pull`, `merge`, `reset` and `checkout` as not;
      - **it survives this repo's own clean-up.** CLAUDE.md §4.2 removes a
        temporary worktree and deletes its branch the moment the work is
        merged. That deletes the worktree's `HEAD` reflog and the branch's
        reflog. A commit made in such a worktree, merged, then cleaned up
        before the next draft, must still count. If no workable signal
        survives it, the test below shows what is lost, and that is written
        here before review.
- [ ] **The fix.** In `draftCommits` or after it, a commit not made here is
      dropped before `buildDraft` sees it. So it can neither name a card
      (`commitKey`) nor count (`:506-520`, `at.commits`, `read.commits`).
- [ ] **Tests that fail on today's code.** These are real-git tests in
      `cli/test/activity-time.test.ts`, with a bare remote and two clones under
      one email (`activity-census.test.ts:98-111` has `newRemote` and `clone`
      to copy). In each, clone B commits `LAI-7 …` and pushes. Clone A has an
      untied session within 15 minutes before that commit's author time. Each
      negative is paired with a positive in the same test, so a setup that
      ties nothing cannot pass it:
      - A has only **fetched** the commit. A's block is not tied to LAI-7, its
        `signals.commits` is 0, `at.commits` is absent, and `read.commits`
        does not count it. Beside it, A's own commit naming LAI-7 still ties
        the block and counts 1.
      - A has B's commit on a local branch, once by `git merge` and once by
        `git pull`. Same assertions.
      - A **made the commit** in a temporary worktree, merged it, then ran
        `git worktree remove` and `git branch -d`, all before drafting. It
        still ties and counts, or the test records the loss the signal
        criterion allows.
- [ ] **Mutation check.** Remove the filter, keeping everything else. The
      fetched and merged tests go red with an assertion error, while the
      positive halves stay green. Prove the mutation landed (a unique anchor
      and a `grep`), restore the file in a trap, and record the run here.
- [ ] `activity-time.ts`'s header (*The rule*, `:45-72`) and `cli/README.md`
      (*What a block is built from* and *The rule*, `:386-416`) say "commits
      you made on this machine", and say how that is known.
- [ ] **Nothing new leaves the machine.** The body's schema is unchanged.
      The existing *only blocks leave* test (`activity-time.test.ts:639`)
      and the stub board's contract (`cli/test/support/local-activity-contract.ts`)
      pass unedited.
- [ ] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Builds on **Strelka** (D-097; board tag `host-strelka`). It is one of three
  collector tasks kept on one machine (LAI-864, LAI-866, LAI-867) so that
  they do not conflict.
- Files: `cli/src/activity-time.ts`, any new `cli/src/activity-*.ts` helper,
  `cli/test/activity-time*.test.ts`, `cli/README.md`. If the signal needs the
  hook (for example, to record hashes at commit time),
  `plugin/scripts/laika-activity-hook` and `cli/test/activity-hook.test.ts`
  are allowed too. The hook must stay fork-free under zsh where it is
  fork-free today (LAI-859's fork-refused test). No new dependencies.
- **Privacy is unchanged** (D-088, D-096). Hashes, reflogs and subjects are
  read on the machine and never sent.
- **For the builder: does `laika activity backfill` double-count across
  laptops?** From the code at `28cf1877`, no:
  - backfill sends no time blocks; it sends hashed pushed-commit keys only
    (`cli/src/activity.ts:645-678`, `countLookback` in
    `cli/src/activity-census.ts:594-670`);
  - the server stores those keys as a set on `(user_id, key)`, earliest day
    kept (`server/src/services/local-activity.ts:410-425`);
  - `activity-lookback.test.ts:410` and `:745` already cover "run twice" and
    "copied with its authorship".

  Confirm it with a two-clone run. If it does double-count, file a
  follow-up from Strelka's block (LAI-300–399) with `discovered-from:
  LAI-864`; it is not this task's scope. Time drafts themselves do
  not reconcile commits across machines: `recordTimeDrafts` copies each
  collector's `signals` as sent (`server/src/services/time-drafts.ts:417-500`).
  After this fix each laptop counts only its own commits, so the two no
  longer overlap.
- Neither SPEC nor DECISIONS states the subject-key rule, the 15-minute
  reach, or whose commits feed drafts. The rule lives only in the code header
  and the README. If the fix changes what SPEC says about drafts (§4.47,
  §13.4), stop and ask CHIEF; no SPEC edit is granted here.

## Review notes (PR #32, round 1; CHIEF, 2026-10-22)

These notes were appended after the task was claimed, so the criteria above
were not edited (§2). **Where a note and the text above disagree, the note
wins.**

**B2. Which reflog entries count as "made here".** This was measured on
2026-10-22 with git 2.50.1, in a scratch repo with a bare remote and two
clones under one email.

- **Made here:**
  - `commit:` and `commit (initial):`;
  - `commit (amend):`. The commit is edited on this laptop, and it keeps its
    author time;
  - every rebase pick: `rebase (pick):`, `rebase -i (pick):` and the
    `reword`, `squash`, `fixup` and `edit` entries;
  - **the `(pick)` entry `git pull --rebase` writes.** On a quiet run it reads
    `pull -q --rebase (pick): <subject>`.

  **Why the pull entry matters:** after a `pull --rebase`, the person's own
  commit lives on only under that entry. Its `commit:` hash
  (`3448c5b`, `commit: LAI-7 mine on A`) is on no branch any more.
  `git log --branches` lists only the replayed `3b0c0a8`, whose sole entry is
  `pull -q --rebase (pick): LAI-7 mine on A`. A rebase replays the branch's
  own commits that upstream lacks, so its picks are this laptop's work, at
  their original author time.
- **Not made here:**
  - `cherry-pick:`. It copies the source's author and author time; the copy
    and the source had the same `%ae` and `%at`. If the source is another
    laptop's commit, counting the copy is this bug again, at that laptop's
    time. If the source was made here, it already counts by its own entry,
    and the copy would count it twice. **This reverses the `cherry-pick`
    clause in *The signal* above.**
  - `pull` (fast-forward), `merge`, `reset`, `checkout`, `branch`, and
    `rebase (start)` / `(finish)`. None of these is a commit made here.
- **An edge, to record rather than fix:** a rebase that flattens a local
  merge of someone else's branch picks their commits too, and they would
  count.

**Add these tests** to the real-git ones in the third criterion:
- **The positive pull case.** A commits `LAI-7 …`, B pushes, and A runs
  `git pull --rebase`. A's block still ties to LAI-7 and counts 1. In the
  same test, B's commit, which the pull brought in, neither ties nor counts.
  This test passes today; it is the guard that stops the filter from being
  too strict.
- **Amend.** A amends its `LAI-7 …` commit. The block ties to LAI-7 and
  counts 1, not 2.
- **Cherry-pick.**
  - A cherry-picks B's `LAI-9 …`. It neither ties nor counts.
  - A cherry-picks its own commit onto a second branch. It counts once.
- **Mutation.** Treat `(pick)` entries as not made here. The pull test goes
  red.

**B3. No escape hatch.** In *The signal*, replace the clean-up bullet's last
sentence ("If no workable signal survives it, the test below shows what is
lost, and that is written here before review."). In the third test bullet,
replace "or the test records the loss the signal criterion allows". Both
become:

> Reflog entries do not survive `git worktree remove` + `git branch -d`. If
> no signal survives the clean-up, stop and ask the owner on the card before
> building. A loss ships only with their word, recorded here.

Measured: a commit made in a temporary worktree, then merged, had 2 reflog
entries before `git worktree remove` and `git branch -d`, and 0 after. It was
still in history.

**Non-blocking: the consumer is `draftDays`, not `buildDraft`.** In *The
fix*, read "dropped before `draftDays` sees it" for "dropped before
`buildDraft` sees it". `buildDraft` (`cli/src/activity-time.ts:806`) is
itself what calls `draftCommits` (`:831`), and it passes the commits to
`draftDays` (`:313`) at `:872`. The filter belongs in `draftCommits`, or
between `:831` and `:872`.
