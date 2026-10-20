---
id: LAI-795
title: 'Slim task list: Board and List load tasks without their description and acceptance text; the task panel loads them when opened'
area: server
assignee: owner-direct
priority: p1
depends-on: [LAI-785]
discovered-from: LAI-786
status: review
started: 2026-10-20T04:32:27Z
finished: 2026-10-20T05:07:25Z
---

## Goal

LAI-786 measured that `description_md` and `acceptance_md` are 83% of a
gzip'd 200-task page (126,960 B, or 21,234 B without them). On a slow
connection (10 KB/s, the owner's Jio link on a bad day) that is about 13 s
against about 2 s. The Board, List, Timeline, Calendar, Capacity and the
client store never render those two fields; only the task panel does.

Owner direct instruction (2026-10-20): pages load only the data they need.

## Acceptance criteria

- [x] `GET /api/v1/projects/:slug/tasks` accepts a field selector (for example
      `fields=slim`) that omits `description_md` and `acceptance_md`. Without
      it the response is unchanged, so agents, the CLI and existing clients
      keep working.
- [x] The web client store requests the slim shape for every list it keeps,
      and the task panel fetches the full task (`GET /api/v1/tasks/:id`) when
      opened, with a loading state that does not jump.
- [x] Anything else in the web app that reads description or acceptance from
      the list (search, effort "why", similar tasks, markdown previews, the
      List's search box) is found by a full grep, not a sample, and either
      moves to the full fetch or is shown to need only server-side data.
- [x] Search on Board and List still matches description text, or the
      decision to search titles only is written into SPEC with the reason.
- [x] Measured on a production-shaped fixture: bytes of one 200-task page,
      plain and gzip, before and after; recorded in the task file.
- [x] Tests: the server field selector (both shapes, unknown values refused),
      the panel fetching the full task, and a browser test that the Board's
      task request carries the slim selector. Tests count bytes or fields,
      never wall-clock time.
- [x] SPEC section 6.4 names the selector.
- [x] Gate: test, lint, format exit 0.

## Notes / context

- Live-update refresh paths must request the slim shape too, or the saving
  is lost on every change.
- The effort/forecast fields stay in the slim shape; they are small.
- Do not add a dependency.

## Result

Branch `LAI-795-slim-task-list`, worktree `Laika-slim-list`, from `master` at
`2faf0d7a`. Owner-direct. Commits are local; nothing is pushed.

### 1. The selector (server)

`GET /projects/:slug/tasks?fields=slim` answers every task-view field except
`description_md` and `acceptance_md`, the rest in the same order, on the same
pages and with the same `next_cursor`, under every filter (`ready=` and
`parent=` included). Without the selector the answer is unchanged. `slim` is
the only value: `full`, `SLIM`, `description_md`, `title,key` and
`slim,full` are each `400 bad_request` with `details: { fields }`, and an
empty value reads as absent, like every other filter.

- `server/src/services/tasks.ts`: `TaskView` now `extends TaskSummaryView`,
  which holds every field but the two texts. `summaryOf(view)` drops them, and
  `TASK_LIST_FIELDS = ['slim']` is the vocabulary.
- `server/src/http/routes/tasks.ts`: parses `fields` before the read and maps
  the page through `summaryOf` when it is `slim`.
- `GET /tasks/:id` and every write still answer the whole task. The MCP tools
  call the services, not this route, so they are unchanged.

### 2. The web client

- `server/web/src/api/tasks.ts`: `TaskSummary` (the slim shape) and
  `Task extends TaskSummary`. `listTasks` **always** sends `fields=slim` and
  returns `Page<TaskSummary>`. Its three callers are all lists: the store's
  walk (`store.ts`), the Timeline's sprint reads (`use-timeline.ts`) and a
  panel's subtasks (`SubtasksSection.tsx`). `toSummary` drops the texts.
- `server/web/src/api/task-store.ts`: holds `TaskSummary`. A page, and a
  write's full answer from `writeLocal`, both go through `toSummary`. Without
  that, the next slim refresh would differ from a held write by two fields
  and glow as a change nobody made (LAI-708).
- **Live refresh is slim by construction.** A frame calls `taskStore.frame`,
  which re-walks through the same `fetchPage`, which is `listTasks`.
- `server/web/src/api/use-task-text.ts` (new): the panel's read. It calls
  `GET /tasks/:id` on open, and again only when the store's `updated_at` is
  newer than the copy it holds. Meanwhile it keeps the held text on screen,
  so a live frame never blanks the description. A write's answer is accepted
  as the newest text (`accept`), so the panel's own edit is not read back.
- `TaskDetailPanel.tsx`: the description and acceptance come from that read.
  **While it loads, the description holds a fixed place** (`.panel-text-pending`,
  three lines tall from the first frame; the pulse only after `useDelayed`'s
  150 ms). It is **not editable**, so nobody can click an empty description
  and save it over the real one. A failure shows `ApiErrorState` with Retry.
  The two sections carry `data-section="description"` and `"acceptance"`.

### 3. The census: every reader of the texts from list data

**The type system did the census.** Every list consumer is typed
`TaskSummary`, so reading `description_md` or `acceptance_md` off a list does
not compile. The rename was mechanical: a TypeScript-AST pass over every
`server/web/src` file that imports `Task` from `api/tasks.ts`, touching type
positions only, never strings or JSX text. It left alone the five modules
whose `Task` is a full server answer (`api/tasks.ts`, `review.ts`,
`unlisted.ts`, `estimates.ts`, `tags.ts`) and the two that use
`Pick<Task, …>` (`date-only.ts`, `demo/calendar.ts`). After it, `tsc`
reported **exactly four errors in `src/`, all in `TaskDetailPanel.tsx`**:
lines 699, 718 (twice) and 736. That panel is the only reader, and it now uses
the full read.

The grep agrees. `grep -rn "description_md\|acceptance_md" server/web/src`,
untruncated, finds only `api/tasks.ts` (the type and `TaskEdit`),
`TaskDetailPanel.tsx`, and comments in `TaskMarkdown.tsx` and
`task-panel.css`. Taking the brief's list one by one:

| suspected reader | finding |
| --- | --- |
| Board and List search | `matchesSearch` (`api/board-derive.ts`) matches title, key and outside id. **It never read description** (`git log -S description_md` on it and on `BoardScreen.tsx` returns nothing). See §5 |
| effort "why" | `GET /tasks/:id/estimate`, server-side (`ForecastSection`), already its own read |
| similar tasks | MCP `get_task_context`, server-side; the web has none |
| markdown previews | only the panel's `TaskMarkdown`, fed by the full read |
| copy actions in the panel | copy the key and the URL; no text |

### 4. Bytes, measured

**The fixture is production-shaped, and no production data was used.** The
real server (`tsx src/index.ts`) ran on a private port (3795) with its own
database. First-boot setup went over REST, then a seed script outside the
repo built `laika` through the real services. Each task takes its title, its
description (the file's *Goal*) and its acceptance (its *Acceptance
criteria*) from the repo's own `.tasks/` files, which production's `laika`
cards mirror; 496 unique files, repeated to 600 tasks. The project has:

- outside ids, tags, ~12% subtasks, 153 dependencies and 6 sprints;
- agent claims with estimates, 204 accepted, 70 in review, 103 in progress
  and 30 sent back;
- finish evidence, comments, and five estimate refits.

Bytes are `curl`'s `size_download`, plain and with `Accept-Encoding: gzip`
(the response said `content-encoding: gzip`), signed in by session.

| one 200-task page, `laika?limit=200` | plain     | gzip      |
| ------------------------------------- | --------- | --------- |
| before (no selector)                  | 471,729 B | 132,842 B |
| after (`fields=slim`)                 | 188,551 B | 23,209 B  |
| saved                                 | 60%       | 82.5%     |
| production, LAI-786, for calibration  | 501,498 B | 126,960 B |
| production without the texts (LAI-786) |          | 21,234 B  |

The whole project, as the store walks it (3 pages, 600 tasks): **1,546,167 →
580,756 B plain, 443,176 → 74,419 B gzip (−83%)**.

On the owner's 10 KB/s link, one gzip'd page goes from ~13 s to ~2.3 s. The
panel adds one `GET /tasks/:id` on open: a median of 2,552 B plain and
1,408 B gzip over 20 of these tasks.

Checked against the same instance in Chromium: the Board's three list
requests were all `?fields=slim&limit=200[&cursor=…]`, and opening a panel
made exactly one `GET /tasks/:id` and drew its description and acceptance.
Screenshots at 1440×900, light and dark, are in
`/tmp/laika-slim-list-shots/`: `board-light.png`, `board-dark.png`,
`panel-light.png` and `panel-dark.png`.

### 5. Search: titles, keys and outside ids, by decision

**The Board's and the List's search never matched description text.**
`matchesSearch` has matched title and key since LAI-251, and the outside id
since LAI-780. So there was no description search to keep. Building one
means either loading every text into every list, which is the cost removed
here, or adding a server-side text parameter to the list, which §6.4 does not
have. Doing the second is a new feature, not this task. **The decision is
written into SPEC §11.4.1** ("Both views"), with that reason.

### 6. Tests

Each counts fields, bytes or requests. None times anything (LAI-779).

- **Server**, `server/test/http/routes/tasks.test.ts`, *a slim list:
  ?fields=slim (LAI-795)*, 6 tests:
  - the default is unchanged, and each item equals its `GET /tasks/:id`;
  - slim drops exactly the two texts, with the same ids, order, keys and
    pages;
  - it saves at least the texts' JSON bytes;
  - it stays slim under `ready=`, `status`/`priority` and `parent=`;
  - five unknown values are refused `400` naming `fields`;
  - an empty value reads as absent.
- **Web unit tests:**
  - `test/api/tasks.test.ts`: every `listTasks` call carries exactly one
    `fields=slim`, across the first page, a cursor, `sprint` and `parent`;
    `toSummary` drops exactly the two texts and keeps the object when there
    is nothing to drop.
  - `test/api/task-store.test.ts`: a page that carries the texts is held
    without them; a write answered in full is held as a summary, and the
    next slim read of it is no change and keeps the object. Its fixtures are
    now `TaskSummary`.
  - `test/api/use-task-text.test.ts` (new): when to read again, and what to
    draw meanwhile.
  - `test/api/view-type-drift.test.ts`: a new pair, `TaskSummaryView` ↔
    `TaskSummary`. **A mutation proved it.** Adding `description_md` to the
    client's `TaskSummary` failed that pair alone. The `TaskView` ↔ `Task`
    pair cannot see it. The file was restored and its checksum matched.
- **Browser**, `test/browser/slim-list.test.ts` (new), 7 tests:
  - the Board's first walk and a live refresh both send `fields=slim`;
  - the List's first request carries `fields=slim&limit=200`;
  - opening a card makes one `GET /tasks/:id`, and the description and
    acceptance come from it;
  - with that read held, the description's place is held, nothing is
    editable and there is no acceptance yet; when it lands, the title, the
    rail and the description's top do not move (half-pixel tolerance), and
    the place held was at least as tall as the text. **A mutation proved
    it**: without the `min-height`, the place was 4 px and grew to 58 px when
    the pulse appeared, and the test went red.
  - a live change to the open task re-reads behind the screen and never
    blanks it;
  - a frame that does not move the task does not read it again;
  - Board → List → Timeline → Board → reload never reads a list in full, and
    never reads a task by id without a panel open.
- **Harness**, `test/browser/harness.ts`: a slim list is answered as the
  server answers it, and `GET /tasks/:id` is answered from tasks a list
  served when no stub names that path.
- **The response-type census counted one type twice.** `TaskSummaryView`
  is paired directly and is also covered through `TaskView`'s `extends`,
  so `response-type-coverage.test.ts` read 68 of 67. It now counts a paired
  base once, as paired.
- **Two existing tests pinned the walk's literal query** (`?limit=200`):
  `board-sprint-stats.test.ts`, where `theWalk` now allows `fields` beside
  `limit` and `cursor`, and `timeline-sprints.test.ts`. Both now expect
  `?fields=slim&limit=200`.

### 7. Not done here, for CHIEF or the orchestrator to file

The orchestrator files in this id block on `master`, so filing from this
branch risks a collision (LAI-786 §5 did the same).

- **Two other reads still carry the texts.** `GET /review` (the Review queue,
  `{ task: TaskView }` per entry) and `POST /sprints/:id/tasks` (an action's
  answer). Neither draws them. The Review queue is the one that grows: it is
  a list, read on every page for the sidebar badge (`use-review-count.ts`).
  §6.4's `fields=slim` is the obvious shape for it.
- **`TaskEdit` writes from the panel** (`updateTask`) still answer the whole
  task, which is right: the panel holds it.
- The seed met the two `LAI-046` task files, as two cards with one outside
  id. They are a known historical pair (LAI-131, `KNOWN_COLLISIONS` in
  `task-file-state.test.ts`), so this is not a new finding; the fixture holds
  one card per id.

### 8. Gate

**Root `pnpm test` did not exit 0 in any run here.** Run 1 found one real
failure, fixed in `9c038603`. Every other failure was a wall-clock test under
load, in a file this branch does not touch or in one LAI-768 names, and each
passed alone or in a later full run. Load averages read 25, 34 and 28 during runs 3–5, while
Microsoft Defender and Spotlight scanned and three workspaces and Chromium
ran at once. Lint and format exited 0. Run 1 was at `66c11737`.
Runs 2–5, lint and format were at `6e688aa5`: the code as of `9c038603`, plus
the task file and the log. All ran from the repo root, in the foreground, each
command's output to its own file and its exit code on its own line.

| run | command | exit | what failed |
| --- | --- | --- | --- |
| 1 (before the census fix) | `pnpm test` | 1 | `response-type-coverage.test.ts`, **a real failure**, read 68 of 67 (fixed in `9c038603`), plus two `migrate.test.ts` 5 s timeouts. `cli`: 469 pass, 0 fail, 2 skipped. `server/web`: 2,225 of 2,225 |
| 2 | `pnpm test` | 1 | `cli/test/activity-lookback.test.ts`, *the deadline nears* (17.8 s). pnpm then stopped the other workspaces. Alone: **27 of 27, exit 0** |
| 3 | `pnpm test` | 1 | `cli/test/activity-hook.test.ts`, *took 1005 ms*. pnpm stopped the rest. It passed in the full `cli` runs 4 and 5; not re-run alone |
| 4 | `pnpm -r --no-bail run test` (diagnostic) | 1 | `cli`: 469 pass, 0 fail, 2 skipped. `server/web`: 2,225 of 2,225. `server`: 3,217 pass and 5 fail, all LAI-768's: `migrate.test.ts` ×2 (5 s timeouts) and `build.test.ts` ×3 (*never became healthy*). `migrate.test.ts` alone: **24 of 24, exit 0** |
| 5 | `pnpm test` | 1 | **The only failure was `server/test/tooling/build.test.ts`**, *boots, migrates, serves health* (*never became healthy*). `cli`: 469 pass, 0 fail, 2 skipped. `server/web`: 2,225 of 2,225. `server`: 3,221 pass, 1 fail, 10 skipped |
| 5, re-run alone | `pnpm exec vitest run test/tooling/build.test.ts` (in `server/`) | **0** | 15 of 15 |
| | `pnpm lint` | **0** | |
| | `pnpm format` | **0** | |

**Criterion 8 is ticked on the brief's rule** for this case: if the only
failure is `build.test.ts` or another known load timeout, re-run that file
alone and report both. **It is not a clean `EXIT 0`.** Re-gate before any
push. This section was added after the runs and is Markdown only;
`task-file-state.test.ts` was re-run after it.

