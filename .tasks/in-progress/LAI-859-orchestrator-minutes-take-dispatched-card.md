---
id: LAI-859
title: 'Time drafts: a person''s untied orchestrator minutes take the card of the builder they were running'
area: cli
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-21T10:35:31Z
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

## Builder notes (2026-10-21, dispatched by CHIEF)

### Measurement (criterion 1)

Read-only, on the owner's machine, 2026-10-21 ~16:10–16:21 local
(Asia/Calcutta). Nothing was sent; `~/.laika/activity` was listed before and
after the run and is unchanged. The drafter ran from this worktree over a
private scratch copy of the token reader's records only (no state, no
token, no hook replay, no sync), deleted afterwards.

- **Today's code**, `laika time draft --days 1`: 2 h 11 min in 16 blocks,
  19 min tied (LAI-822 1, LAI-849 2, LAI-841 1, SKYNET-70 7 + 8). Built from
  25 replies, 20 typed prompts, 27 orchestrator turns, 0 marks; 59
  Omnigent-started turns left out.
- **The skip lines cannot say why.** `skip-sessions` held 206 lines, **all
  206 with two fields** (a time and an id), 79 of them today naming 48
  sessions. Nothing local tells an Omnigent sub-agent from a `CI` or
  `LAIKA_ACTIVITY_SKIP` session, so the hook now writes a word (below).
- **The dispatched sessions carry their keys and reply times.** Of today's
  skipped sessions, 29 have replies in the token reader's records today
  (3,546 replies, each with its time). 13 sessions carry a key by the token
  reader's rule (mark, else branch) on 2,331 of those replies; 16 carry
  none. Keys: LAI-758, LAI-775, LAI-814, LAI-822, LAI-827, LAI-828, LAI-830,
  LAI-831, LAI-832, LAI-834, LAI-836, LAI-841, LAI-842, LAI-849, LAI-859,
  LAIKA-617, LAIKA-618.
- **New code, lines as recorded (no word):** identical to today's —
  131 min, 16 blocks, 19 min tied. Old lines lend nothing.
- **New code, every skip line given the new hook's word** (an upper bound:
  it treats every session skipped today as Omnigent-dispatched, which the
  records cannot confirm): **131 min — not one minute added — in 29 blocks,
  91 min tied**, 40 untied. Today's untied blocks become:

  | block (local) | min | becomes |
  | --- | --- | --- |
  | 00:00–00:05 | 5 | LAI-814 2, LAIKA-617 2, LAIKA-618 1 |
  | 00:28–00:33 | 5 | LAIKA-617 3, LAIKA-618 2 |
  | 01:09–01:28 | 19 | LAI-827 12, LAI-830 5, LAI-831 2 |
  | 08:59–09:20 | 21 | untied — no builder ran |
  | 10:56–11:27 | 31 | untied 11 (10:56–11:07), LAI-832 11, LAI-836 9 |
  | 12:14–12:25 | 11 | untied 1, LAI-832 9, LAI-849 1 |
  | 12:44–12:50 | 6 | LAI-832 2, LAI-849 2, LAI-841 1, LAI-822 1 |
  | 12:59–13:00 | 1 | joins its stretch: LAI-822 1, LAI-849 3, LAI-841 1 |
  | 13:51–13:57 | 6 | untied 1, LAI-822 3, LAI-841 2 |
  | 13:58–13:59 | 1 | LAI-822 1 |
  | 14:33–14:39 | 6 | untied — no builder ran |

  The SKYNET-70 blocks (the person's own key) are unchanged.

### The rule, as built (D-095)

- `cli/src/activity-time.ts`: `draftDays` (with `draftBlocks` its wrapper)
  takes `dispatched` replies. Each dispatched session is a lane by the same
  `eachActiveMinute` rule (`GAP_S` chain, `TAIL_S` tail) — extracted from
  the existing loop so both use one definition — but fills a `lending` map,
  never `active`: it makes no minute. A minute whose person lanes, commit
  keys included, carry no key takes the lending keys of that minute, split
  equally as parallel keys already are. Dispatched replies add no count.
  `Draft.lent` (local only) names the blocks that took a lent key, and
  `read.dispatched` counts the replies read for keys.
- `cli/src/activity-usage.ts`: `skipLines` reads each skip line's third
  field; `draftSources` returns a session whose newest line says `omnigent`
  as `dispatched` (same task rule, same `laika-repos` scope filter), and
  still leaves every other skipped session out whole. Token counting is
  unchanged: every skipped session is still automated (guarded by a new
  assertion in `activity-usage.test.ts`).
- `cli/src/activity.ts`: `laika time draft` adds `a dispatched builder’s
  card` to each such block's line, and a closing line counting those blocks
  and the dispatched replies read. `--json` (the body) is unchanged.
- **The hook** (`plugin/scripts/laika-activity-hook`): a sub-agent under an
  Omnigent runner — `OMNIGENT=1` and a non-empty
  `OMNIGENT_RUNNER_PRIMARY_SESSION_ID`, neither the primary nor the
  orchestrator — gets ` omnigent` after its id in `skip-sessions`. `CI`,
  `LAIKA_ACTIVITY_SKIP` (whatever Omnigent says) and `OMNIGENT=1` under no
  runner id write the two-field line as before. One builtin `printf`,
  fork-free under zsh (a new fork-refused test). **Safe for older hooks and
  readers:** an old line has no word and lends nothing; an old reader splits
  on spaces and reads the first two fields, so it reads a new line as the
  skipped id it always was; compaction keeps whole lines.
- **No `laika activity on` re-run is needed.** It installs a command that
  runs the checkout's hook script by path, and this change does not alter
  the command. The machine gets the word once the checkout its hooks point
  at is updated after merge; sessions skipped before then lend nothing.

### Tests — fail first, then pass

Run from `cli/` with `node --test <file>`, against the unchanged source
first, then with the change:

| file | before the fix | after |
| --- | --- | --- |
| `test/activity-time.test.ts` | **EXIT 1** — 38 tests, 32 pass, **6 fail** (the 6 new), all `ERR_ASSERTION` | EXIT 0 — 38/38 |
| `test/activity-hook.test.ts` | **EXIT 1** — 92 tests, 89 pass, **3 fail** (the new word test under sh and zsh, the fork-refused test), all `ERR_ASSERTION` | EXIT 0 — 92/92 |
| `test/activity-usage.test.ts` | — (a guard, not a fail-first test) | EXIT 0 — 43 tests, 41 pass, 2 skipped (`LAIKA_PERF`-gated, as on master) |

The new rule tests: a dispatched key lent, with the person's counts only;
two builders splitting a minute, two on one card one key; the person's own
key winning in the same stretch as lent minutes; a builder alone making
nothing, and beside the person labelling only their minutes; a skipped
session with no word or another word lending nothing, beside the same
session with `omnigent` lending (reader level, temp `HOME`); the command's
local marker and `--json` carrying none of it. Each negative is paired with
a positive in the same test, so a setup that lends nothing cannot pass it.
`pnpm --dir cli run typecheck` EXIT 0.

Mutations, each restored from a backup in a trap, each landing proved by
a unique anchor and a grep (`git status` clean after):

| mutation | red |
| --- | --- |
| lend even when the person's lanes have a key | own-key test, reader test, command test |
| every skipped session lends, word or not | reader test, two pre-existing fixture tests, command test |
| the hook writes the word for every skipped session | the CI / `LAIKA_ACTIVITY_SKIP` test, under sh and zsh |
| dispatched sessions make minutes | all four pure rule tests, reader test, command test |

### Gate runs

The shared gate script (`gate.sh`, serialised, `VITEST_MAX_WORKERS=2`):

| run | HEAD | load at start → end | TEST | LINT | FMT |
| --- | --- | --- | --- | --- | --- |
| 1 | `e92a657f` | 5.35 → 9.44 | 0 | 0 | 0 |

Run 1: cli 546 tests, 544 pass, 2 skipped; server 3375 passed, 10 skipped;
server/web 2630 passed; the failure grep is empty; porcelain clean before
and after. The final gate, on the review commit, is in the PR body.

### Discovered (not filed — CHIEF files)

- `plugin/README.md` ("Count a session nobody is typing in") and
  `docs/SPEC.md` (the collector paragraph: "keeps only that session's id")
  do not mention the new word. Both are outside this task's files.
- 16 of today's 29 dispatched sessions carried no key, so their tokens are
  unattributed too (D-091 item 2 expects every dispatched builder to mark
  its card).
- A block counts as having "taken a builder's card" if any one of its
  minutes did, so a block that was mostly the person's own key can carry
  the marker (12:55–13:00 above).
