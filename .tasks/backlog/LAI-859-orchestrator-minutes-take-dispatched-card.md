---
id: LAI-859
title: 'Time drafts: a person''s untied orchestrator minutes take the card of the builder they were running'
area: cli
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

Time the owner spends directing builders through an Omnigent orchestrator
(polly) is drafted on the card those builders were working on, not as *Needs
a card*.

**What the owner saw (2026-10-21).** `laika time draft --days 1` drafted
2 h 11 min in 16 blocks, with 19 minutes tied to a task and 0 Laika marks.
The owner asked: "its showing me needs a card why its not auto recognised
that ? fix that".

**Why** (found 2026-10-21, at `d36d2ee5`):

- The owner works by typing to polly. Those turns are a lane of their own
  (`cli/src/activity-time.ts`, `push('o:…', { task: null, repo: null })`),
  so they carry no key and no repository.
- The sessions that do carry a key are the builders polly dispatches: a
  `LAI-NNN-…` branch, or a `start_working` mark. They are skipped as
  automated (D-080, LAI-757). The token reader sends their tokens marked as
  automated, and the time drafter leaves them out whole (`draftSources`).
- A commit's key ties only a session lane that has a repository
  (`commitKey`), never the orchestrator lane.

So, as designed, nothing ever ties the owner's own minutes to a card.

**The owner's decision (2026-10-21).** Asked *"while a builder you dispatched
is running, its card labels your polly minutes; its time is still not counted
as yours; if several builders run at once, the minutes split equally, the way
parallel sessions already split — OK?"*, the owner answered **"yes"**. It is
recorded as **D-095**.

## Acceptance criteria

- [ ] **Measure first, and record it here.** Using the owner's local records
      (read-only, never sent), show which of today's untied blocks the rule
      would tie, and to what. Confirm the dispatched sessions' local records
      carry their keys (branch or mark) and their reply times. Record counts
      and keys only, never paths, branch names or text.
- [ ] **The rule.** A minute in which the person was active, but no lane of
      theirs carried a key, takes the keys of the dispatched sessions active
      in that minute. "Active" uses the same lane rules as today (`GAP_S`
      chaining, the `TAIL_S` tail). The minute is split equally between
      those keys, as parallel lanes already are.
- [ ] A dispatched session never *makes* a minute. With no person lane
      active, nothing is drafted, as today. A minute the person's own lane
      already tied keeps its keys, and gains none from dispatched sessions.
- [ ] **Only Omnigent-dispatched sessions lend a key**, not CI or
      `LAIKA_ACTIVITY_SKIP` sessions. If the local records cannot tell those
      apart, record the evidence here and implement the narrowest rule the
      records allow. Any change to the activity hook (for example, noting
      why a session was skipped) is named here, and is safe for people whose
      hook predates it.
- [ ] **Nothing new leaves the machine.** A block still carries a start, an
      end, minutes, one key or `null`, and counts. The sent body's schema is
      unchanged. `laika time draft` says, locally, which blocks took a
      dispatched builder's card.
- [ ] `cli/README.md`'s *The rule* and `activity-time.ts`'s header say the
      new rule. **D-095** is appended to `docs/DECISIONS.md` and quotes the
      owner.
- [ ] Tests fail on today's code: pure rule tests in `cli/test/` for a
      dispatched key lent, split between two dispatched keys, the person's
      own key winning, a dispatched session alone making nothing, and a
      skipped non-Omnigent session lending nothing.
- [ ] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Owner-direct (CLAUDE.md §2). Files: `cli/src/activity-*.ts`,
  `cli/test/activity-*.test.ts`, `cli/README.md`, `docs/DECISIONS.md`
  (D-095 only) and, if the skip reason is needed,
  `plugin/scripts/laika-activity-hook` with its tests. No new dependencies.
- **Privacy is unchanged** (D-088): only a key leaves, as today. The lending
  happens on this machine.
- LAI-834 (signal times) changes the same drafter next. Keep this change
  focused so the two merge cleanly.
