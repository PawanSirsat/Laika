---
id: LAI-785
title: 'Task panel: call the size Effort and say the forecast and the tokens in plain words (server/web/ + named server/src/mcp/ text + docs/SPEC.md §11.4)'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
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

- [ ] **Size is called Effort everywhere in the UI**: the task panel, the
      Board card chip's hover, the List's column header and its *Sort by*
      title, the Board's card-field toggle, and the sprint card's forecast
      line. Words where there is room — *Extra small, Small, Medium, Large,
      Extra large* — and `XS`…`XL` kept as the compact chip on cards and List
      rows.
- [ ] **Nothing an agent or a URL uses changes name**: `size`, the levels, the
      card-field key `size` and the List's `sort=size` keep working, and a
      test proves `sort=size` still sorts by effort.
- [ ] **One headline**: the effort in words and the time as one plain range,
      *Small · about 40 min to 1.5 h*; with too little history for hours,
      *Small* and *Time estimate after 10 finished tasks*, once.
- [ ] **One comparison line once there is an actual**, from the estimate
      frozen at start: *Estimated 40 min–1.5 h · took 1.6 h · a little over*,
      with a verdict of *on target*, *a little over*, *well over* or *faster
      than expected*. No *At start* tile.
- [ ] **A timeline line only when there are values**: *Building 1.6 h ·
      waiting for review 41 h · rework 20 min*, each part only when non-zero.
      No tile and no line ever shows `—` or *Early*.
- [ ] **The token estimate is one line when it exists, and nothing when it
      does not** — at most one short hint inside the disclosure.
- [ ] **Override**: a small *Change* control beside the effort, options
      *Automatic (Small)*, *Extra small*…*Extra large*, for the same readers
      as today. It still sends `PATCH { size }`.
- [ ] **A collapsed *Why Small?* disclosure** with plain sentences and arrows
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
- [ ] **Privacy unchanged**: per person only where the server sends it (an
      owner or admin everyone, a person their own), totals for anyone else;
      the existing per-reader tests still pass.
- [ ] Agent-facing text says *effort* where it describes the field (the named
      MCP strings below); `docs/SPEC.md` §11.4.1 and §11.4.2.1 describe the
      new screen.
- [ ] Tests first where behaviour changes; every test asserting the old
      strings is updated, found by an untruncated sweep for `Size`, `Build
      time`, `At start`, `Review wait`, `Typically off`.
- [ ] Screenshots, light and dark at 1366 and 390, before and after, in
      `/tmp/laika-effort-panel-shots/`: a task with no history, an
      in-progress task, a finished task over its estimate, a task with tokens
      and a budget, and the Board and List showing Effort.
- [ ] `pnpm test`, `pnpm lint` and `pnpm format` at the repo root, each with
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
