## 2026-10-21T11:02:00Z — LAI-859

**What changed**
- plugin/scripts/laika-activity-hook — a sub-agent under an Omnigent runner
  (`OMNIGENT=1`, a runner primary id, neither primary nor orchestrator) gets
  ` omnigent` after its id in `skip-sessions`; `CI`, `LAIKA_ACTIVITY_SKIP` and
  no-runner lines unchanged; still one builtin `printf`
- cli/src/activity-usage.ts — `skipLines` reads the word; `draftSources`
  returns those sessions' replies apart as `dispatched`, same task rule and
  scope filter; token counting unchanged
- cli/src/activity-time.ts — `draftDays` lends dispatched keys to minutes no
  person lane tied (`eachActiveMinute` shared with the existing lanes, a
  `lending` map that never makes a minute); `Draft.lent` and
  `read.dispatched`, local only
- cli/src/activity.ts — `laika time draft` marks lent blocks and counts them
- cli/test/activity-time.test.ts, cli/test/activity-hook.test.ts,
  cli/test/activity-usage.test.ts — 4 pure rule tests, a reader test, a
  command test, 2 hook tests × 2 shells, a fork-refused hook test, a token
  guard
- cli/README.md — *The rule*, what a block is built from, the skip line, the
  orchestrator paragraph
- docs/DECISIONS.md — D-095

**Decisions**
- The hook writes a reason word, not the runner's primary id — the id would
  allow lending only to the orchestrator that dispatched, but it is more data
  stored for a rule the owner did not ask for; the word is enough to tell
  Omnigent from CI and `LAIKA_ACTIVITY_SKIP`.
- A line with no word lends nothing, old ones included — the 206 lines on
  the owner's machine cannot be told apart, so the narrowest rule wins and
  the change takes effect for sessions started after the hook updates.
- Dispatched sessions take no commit key and add no counts — their key is the
  token reader's (mark, else branch), and their replies are not the person's
  evidence; counting them would read as the person's work.
- D-095 amends D-088 item 9 rather than D-090: D-088 item 9 is the rule that
  dispatched agents are not the person's, and D-090 says nothing about tasks.
- `draftBlocks` kept as a wrapper of the new `draftDays`, so the sent path
  and every existing caller are unchanged and LAI-834 merges against the
  same signature.

**Discovered**
- `plugin/README.md` and `docs/SPEC.md`'s collector paragraph still say the
  hook keeps only the session id; outside this task's files. Not filed
  (CHIEF files), in the report.
- 16 of today's 29 dispatched sessions carried no key, so they lend nothing
  and their tokens are unattributed.
- A block is marked as having taken a builder's card if any one of its
  minutes did, so a mostly-own block can carry the marker.

**State**
In .tasks/review/. Gate run 1 green (0/0/0); the final gate is in the PR.
