# effort-panel — 2026-10-20

Owner-direct worktree `Laika-effort-panel`, branch `LAI-785-effort-panel`,
cut from `master` at `fd279cfe` and merged with `master` at `499ae2fb`.
Dispatched to make the task panel's forecast and tokens readable. Commits are
local and not pushed. Card LAIKA-588.

## 2026-10-19T23:05:00Z — LAI-785

**What changed**
- server/web/src/api/estimates.ts — effort words (`effortWord`), estimated
  times rounded the way a person says them (`roughDuration`, `timeRange`,
  `shortRange`), the verdict (`verdictOf`), the comparison, timeline and
  token lines, *why* rows as sentences with arrows (`whyRows`), the accuracy
  and claim sentences, `isRough`, `effortTitle`. The replaced helpers
  (`accuracyLine`, `levelsLabel`, `forecastRange`, `sizeTitle`,
  `tokensWaitNote`, `tokenAccuracyLine`, `claimNote`) are gone. Nothing else
  used them.
- server/web/src/routes/screens/task/ForecastSection.tsx, forecast.css — the
  Effort section: headline, comparison, timeline, token line, notes,
  *Change*, folded *Why …?*.
- server/web/src/routes/screens/task/TokensSection.tsx, tokens.css — one
  headline, the budget bar only when set, everything else in *Details*.
- server/web/src/components/SizeChip.tsx, size-chip.css; list/list-derive.ts,
  list.css (column 3.5 → 5.5rem); board/card-fields.ts; sprints/SprintCard.tsx;
  api/budgets.ts; usage/BudgetsCard.tsx — the word *Effort*, and *high end*
  instead of *p80*.
- server/src/mcp/write-tools.ts, read-tools.ts, server/test/mcp/read-tools.test.ts
  — named crossing: wording only.
- docs/SPEC.md §11.4.1, §11.4.2.1 — named crossing: the screen paragraphs.
- Tests: web estimates, budgets, card-fields, list-derive; browser task-size,
  task-tokens, sprint-forecast.
- .tasks/review/LAI-785-effort-panel-plain-forecast-and-tokens.md — filed,
  claimed and moved to review, with the result, sweep, mutations and gate.

**Decisions**
- The *why* sentences are rewritten client-side from the server's labels by
  factor `key`, falling back to the server's sentence. Changing the server's
  labels would have reworded `get_task_context` and the server's estimate
  tests for a UI request. A web test reads the server's label templates so
  a reworded one fails first instead of quietly falling back.
- The timeline line is drawn only when there was review wait or rework. A
  build alone repeats the comparison line's *took 1.6 h*.
- *Faster than expected* starts under 0.75× the likely time, not under it,
  because half of all tasks finish under their p50 by definition.
- `rough estimate` uses the owner's two conditions literally: fewer than 5
  measured estimates, or a typical error above 2×.
- The MCP keeps *Build time: likely …* for agents. It is the term §4.32 uses,
  and the owner's rename was Size → Effort.
- The budget source wording (*the token estimate’s high end, frozen at
  claim*) changed in the shared helper, so the Usage page reads the same.

**Discovered**
- Playwright's `innerText` follows `text-transform`, so the List header and
  section titles read `EFFORT`. The tests read `textContent` for the word.
- The List's Effort header was cut to `EFFOR` at 3.5rem. It is now widened,
  with a browser assertion that the label fits its cell at 1366.
- The Review page shows no size, and nothing in the app filters by size.
  The only `size` in a URL is the List's `sort=size`, which is unchanged.

**State**
In `.tasks/review/`. Card LAIKA-588 is still In progress, for the owner to
move. Not pushed: the dispatch said to commit locally only.

The root `pnpm test` exited 1 on two server tests only, both in
`test/tooling/build.test.ts` (*built server never became healthy* under the
parallel run). That file alone exits 0, 15/15. `pnpm lint` and `pnpm format`
exit 0. web 2167/2167, cli 429 pass and 2 skipped of 431.
