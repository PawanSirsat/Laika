---
id: LAI-785
title: 'Task panel: call the size Effort and say the forecast and the tokens in plain words (server/web/ + named server/src/mcp/ text + docs/SPEC.md §11.4)'
area: web
assignee: owner-direct
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-19T22:21:02Z
---

## Goal

The owner, 2026-10-20: the task panel's Forecast section is confusing and hard
to understand. Today it shows an `S` chip, *Computed by Laika from this task
and the project's finished work*, a *Size* dropdown *Laika's (S)*, seven tiles
— *Build time* `44 min–1.3 h`, *At start* `S · 38 min–1.3 h`, *Tokens* `Early`,
*Actual build* `1.6 h`, *Actual tokens* `—`, *Review wait* `41 h`, *Rework*
`—` — two separate *Tokens after 10 finished tasks…* notices, a *Why S* list of
signed weights (`-0.4`, `-0.2`, `0.0`…), and *This project: Typically off by
×2.44 · p80 held 50% · 6 tasks measured*. The task panel's Tokens section has
the same problem.

When this is done, the UI calls a task's size **Effort**, the section says what
a person needs in one or two plain lines, and everything else is one click
away. The API, the database and the MCP field names do not change.

Board card: LAIKA-588 (`external_ref` LAI-785).

## Acceptance criteria

- [x] **Size is called Effort everywhere in the UI**: the task panel, the
      Board card chip's hover, the List's column header and its *Sort by*
      title, the Board's card-field toggle, and the sprint card's forecast
      line. Words where there is room — *Extra small, Small, Medium, Large,
      Extra large* — and `XS`…`XL` kept as the compact chip on cards and List
      rows.
- [x] **Nothing an agent or a URL uses changes name**: `size`, the levels, the
      card-field key `size` and the List's `sort=size` keep working, and a
      test proves `sort=size` still sorts by effort.
- [ ] **One headline**: the effort in words and the time as one plain range,
      *Small · about 40 min to 1.5 h*; with too little history for hours,
      *Small* and *Time estimate after 10 finished tasks*, once.
- [ ] **One comparison line once there is an actual**, from the estimate
      frozen at start: *Estimated 40 min–1.5 h · took 1.6 h · a little over*,
      with a verdict of *on target*, *a little over*, *well over* or *faster
      than expected*. No *At start* tile.
- [x] **A timeline line only when there are values**: *Building 1.6 h ·
      waiting for review 41 h · rework 20 min*, each part only when non-zero.
      No tile and no line ever shows `—` or *Early*.
- [x] **The token estimate is one line when it exists, and nothing when it
      does not** — at most one short hint inside the disclosure.
- [x] **Override**: a small *Change* control beside the effort, options
      *Automatic (Small)*, *Extra small*…*Extra large*, for the same readers
      as today. It still sends `PATCH { size }`.
- [x] **A collapsed *Why Small?* disclosure** with plain sentences and arrows
      instead of signed numbers (*↓ No acceptance criteria (most tasks here
      have 3)*, *↓ Not blocked by anything*, *= Description length is
      typical*); rows that change nothing are left out; the similar finished
      tasks stay links inside it.
- [ ] **Accuracy in plain words inside the disclosure** (*Estimates here have
      been off by about 2.4× on average so far (6 tasks)*), and *rough
      estimate* beside the headline when the project has fewer than 5
      measured tasks or is typically off by more than 2×. No *p80* anywhere
      and no `×` in the headline.
- [ ] **Tokens section: one headline** — total tokens without cache reads and
      the cost labelled *API-equivalent, not your bill* — then the budget bar
      only when a budget is set, and the runaway banner only when it fires.
      Everything else (rounds, per person and agent, the share tied to a
      task, cache reads, the forecast, setting a first budget) sits in one
      collapsed *Details*. A started task with no tokens shows one quiet line.
- [x] **Privacy unchanged**: per person only where the server sends it (an
      owner or admin everyone, a person their own), totals for anyone else;
      the existing per-reader tests still pass.
- [x] Agent-facing text says *effort* where it describes the field (the named
      MCP strings below); `docs/SPEC.md` §11.4.1 and §11.4.2.1 describe the
      new screen.
- [x] Tests first where behaviour changes; every test asserting the old
      strings is updated, found by an untruncated sweep for `Size`, `Build
      time`, `At start`, `Review wait`, `Typically off`.
- [x] Screenshots, light and dark at 1366 and 390, before and after, in
      `/tmp/laika-effort-panel-shots/`: a task with no history, an
      in-progress task, a finished task over its estimate, a task with tokens
      and a budget, and the Board and List showing Effort.
- [x] `pnpm test`, `pnpm lint` and `pnpm format` at the repo root, each with
      its own exit code.

## Named cross-area edits (D-033, D-034)

The owner asked for agent-facing description text and the SPEC's screen
wording to change with the UI. These are the only edits outside
`server/web/`, named one by one:

- `server/src/mcp/write-tools.ts` — the `.describe()` text of the `size`
  field in `TASK_FIELDS`, the `update_task` tool description's *its size*,
  the `update_task` `size` field's `.describe()`, and the `start_working`
  description's sentence about `estimate.size`. Wording only; no schema,
  name or behaviour changes.
- `server/src/mcp/read-tools.ts` — the `sizeText` lines of `get_task_context`
  (`### Size …` heading and its sentences). Wording only.
- `server/test/mcp/read-tools.test.ts` — the two assertions on `### Size`.
- `docs/SPEC.md` §11.4.1 — the card bullet's *So is the **size*** sentence and
  the List paragraph's *size (D-085, …)* item; §11.4.2.1 — the *Forecast
  section* and *Tokens section* paragraphs of **Task detail**.

## Notes / context

- `server/web/src/routes/screens/task/ForecastSection.tsx`,
  `TokensSection.tsx`, `forecast.css`, `tokens.css`,
  `server/web/src/api/estimates.ts`, `components/SizeChip.tsx`,
  `routes/screens/list/list-derive.ts`, `routes/screens/board/card-fields.ts`,
  `routes/screens/sprints/SprintCard.tsx`.
- The *why*'s labels are the server's sentences
  (`server/src/services/estimate-model.ts`, `forecast()` and `rollUp()`).
  The client rewrites them by factor `key` and falls back to the server's
  label for anything it does not recognise; a web test reads the server's
  templates so a reworded label cannot silently fall back.
- No new dependency.

## Result

Built under the owner's direct request, in the temporary worktree
`Laika-effort-panel` on `LAI-785-effort-panel`, cut from `master` at
`fd279cfe` and merged with `master` at `499ae2fb`. Commits are local and
not pushed.

**Effort section** (`server/web/src/routes/screens/task/ForecastSection.tsx`,
`forecast.css`; wording in `server/web/src/api/estimates.ts`):

- Headline: `Large · about 1 to 2.5 h`, plus `rough estimate` when fewer
  than 5 estimates are measured or they are typically off by more than 2×.
  Estimated times are rounded the way a person says them: minutes to 5,
  hours under 10 to a half (`roughDuration`). With no hours yet:
  `Time estimate after 10 finished tasks (3 so far)`, once.
- Comparison: `Estimated 40 min–1.5 h · took 1.6 h · a little over`. The
  verdict is *faster than expected* under 0.75× the likely time, *on target*
  up to the pessimistic end, *a little over* up to 1.5× that, *well over*
  past it.
- Timeline: `Building 1.6 h · waiting for review 41 h · rework 20 min`.
  It is drawn only when there was review wait or rework, because a build
  alone repeats the comparison line.
- Tokens: `Tokens: estimated 900K–2.1M · used 1.4M` (the range frozen at
  start), or `Tokens: about 1.2M to 2.5M to build` before work starts.
  Nothing when there is no estimate; the one hint is inside the disclosure.
- *Change*: a bare `Dropdown` showing `Change`, options `Automatic (Large)`,
  `Extra small` … `Extra large`, same `mayEdit` as before, still
  `PATCH { size }`.
- *Why Large?* (or *Why Laika estimated Medium* when a person set it) is a
  `<details>`, closed by default. It holds the factor sentences with ↑ ↓ =,
  the similar tasks as links, the typical task, what was said at claim, the
  accuracy sentence and the token record or hint. Priority and anything
  under 0.05 levels are left out. Only the description-length row is kept
  at `=`.
- The sentences are rewritten from the server's factor labels by `key`. An
  unrecognised label falls back to the server's own text, and
  `estimates.test.ts` reads `estimate-model.ts` and `estimates.ts` so a
  reworded template fails there first.

**Tokens section** (`TokensSection.tsx`, `tokens.css`): one headline,
`At least 4.01M tokens · $44.07 API-equivalent, not your bill`. Then the
budget bar only when a budget is set (with the lead's editor, as before),
the runaway banner only when the server sends it, and one closed *Details*
with cache reads, the share tied to a task, the build's token estimate,
cost caveats, a first budget for a lead, by review round, and by person and
agent. A started task with none: `No tokens tied to this task yet (an agent
ties them by working on a branch named LC-3-…).` Who sees whose part is
untouched: it is still the server's `people`.

**Renames.** `effortTitle` on the chip's hover
(`Effort: Extra large, set by a person · Laika’s estimate: Medium · about 25 to
50 min`). The List column is `Effort`, widened from 3.5rem to 5.5rem because
the header read `EFFOR`; a browser test now asserts it fits at 1366. The
card-field toggle is `Effort`, and the sprint card's hover says *the effort
left*. The budget's source reads *the token estimate’s high end, frozen at
claim*, not *p80* (`budgets.ts`, so the Usage page too, and `BudgetsCard`'s
empty line). The Review page shows no size, so nothing changed there. There
is no size filter anywhere, only the List sort, and `sort=size` still works
(unit and browser tests).

**Named crossings** as listed above: the MCP wording in `write-tools.ts` and
`read-tools.ts` (`### Effort M (medium)`), with `read-tools.test.ts`, and
`docs/SPEC.md` §11.4.1 and §11.4.2.1. `get_task_context` still says
`Build time: likely …` for agents, which is the §4.32 term.

**Sweep** (untruncated `grep -rn` and `grep -rnw Size` over `server/web/src`,
`server/web/test`, `server/src/mcp`, `server/test/mcp`, `plugin`, `cli/src`):
every test that asserted the old strings was updated (`task-size`,
`task-tokens`, `estimates`, `list-derive`, `sprint-forecast`, `budgets`,
`read-tools`). What is left is not UI text: a type comment in
`estimates.ts`, font-size CSS comments, a fixture task titled *Size and
forecast every task*, the tests' own negative assertions, and the MCP
*Build time* line above.

**Mutations**, each confirmed landed, run, and restored by checksum: a
reworded server label, the *a little over* threshold, the priority row kept,
*Details* open by default, *Why* open by default, the budget bar folded away,
and the *None of these are yours* line dropped. All seven turned the named
test red.

**Screenshots** in `/tmp/laika-effort-panel-shots/`, `before-*` and
`after-*`, light and dark at 1366 and 390: `no-history`, `in-progress`,
`finished-over` (the owner's example; `after` also has `why-open`),
`tokens-budget` (`after` also has `details-open`), `board`, `list`. 24
before and 32 after.

**Gate**, at the repo root after the last code edit, each command on its own
with its output in a file and never piped:

- `pnpm test`: **exit 1**. web: 2167 tests, 2167 passed, 0 failed. cli: 431
  tests, 429 passed, 2 skipped, 0 failed. server: 3096 tests in 152 files,
  3086 passed, 8 skipped, **2 failed**, both in `test/tooling/build.test.ts`
  (*keeps an idle connection open for 65 s* and *serves the committed
  fallback*), each with `built server never became healthy on port …`. That
  is the health-check wait timing out while every workspace runs at once.
  This change touches nothing that file builds or serves.
- `npx vitest run test/tooling/build.test.ts` in `server/`, alone: **exit 0**,
  15 tests, 15 passed, in 21.9 s.
- `pnpm lint`: **exit 0**.
- `pnpm format`: **exit 0**.

Also run along the way: `node --test test/browser/task-size.test.ts
test/browser/task-tokens.test.ts test/browser/sprint-forecast.test.ts` in
`server/web`: exit 0, 25 tests, 25 passed. `npx vitest run
test/mcp/read-tools.test.ts test/mcp/write-tools.test.ts` in `server/`: exit
0, 70 tests, 70 passed.

## Review round 1 — CHANGES REQUIRED (2026-10-20)

Relayed to the builder by the orchestrator. The criteria it fails are
unticked above.

**Blocker: the verdict can contradict the range printed beside it.**
`comparisonLine` shows the range rounded by `roughDuration`, but `verdictOf`
judged against the unrounded p50 and p80. The reviewer's probe
(`/tmp/review-effort/probe.ts`):

- `Estimated 40 min–1.5 h · took 1.4 h · a little over`
- `Estimated 20–50 min · took 48 min · a little over`
- `Estimated 24 h–3 d · took 3 d · a little over`
- `Estimated 40 min–1 h · took 1.2 h · on target`
- `Estimated 15–20 min · took 22 min · on target`

Fix: judge the actual against exactly the rounded ends that are displayed,
with one function producing both the displayed ends and the verdict's input.
Add a test for each of the five rows.

**Also fix (decided by the reviewer):**

1. Below the shown low end is *faster than expected*. Inside the shown range
   is *on target*. Above it is *a little over* up to 1.5× the shown top, and
   *well over* beyond. Test each boundary on the displayed values.
2. Label the comparison *Estimated at start …*, so it is not confused with
   the current headline range.
3. Accuracy wording: the server's `typical_error` is a median. Say
   *typically off by about 2.4×*, not *on average*. With one measured task,
   say *(1 task so far)*, or hide it if there are fewer than 3.
4. `roughDuration` must not mix units across the day boundary (`24 h–2 d`
   should read `1–2 d`). Format both ends of a range in the same unit.
5. Show the budget bar only when a lead or admin actually set a budget. For
   the default budget (the token estimate's high end frozen at claim), show
   nothing until it reaches 80%, then only the alert line. The runaway
   banner rule stays as it is.
