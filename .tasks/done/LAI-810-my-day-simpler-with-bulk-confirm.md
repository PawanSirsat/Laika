---
id: LAI-810
title: 'My day: a bounded right column with Draft my time on top, and drafted blocks you can select, page through and confirm in bulk'
area: web
assignee: owner-direct
priority: p1
depends-on: [LAI-796]
discovered-from: LAI-796
started: 2026-10-20T11:13:37Z
status: done
finished: 2026-10-20T12:41:44Z
---

## Goal

My day stays readable on a busy day. Today, with live data, it is not. The
owner, 2026-10-20, with two screenshots of production:

> *"the right side list that must be limited and scroll but dont show too
> much and also show the draft my time on top on right side, also make that
> overall My Day page simplify and improve the UI UX … lot of task but i
> need to do the one by one confirm; that must show in scroll then in
> pagination; also add the all select and multi select"*

What the screenshots show:
- **The right column is unbounded.** "Waiting on your review" has **200**
  items and draws every one, so the column runs on far past the page. Draft
  my time is at the bottom.
- **The drafted list is long, one card per block**, each with six buttons:
  Confirm, Card…, General, Minutes…, Split…, Not work. Confirming a day means
  clicking Confirm on each one in turn. Some blocks need a card first: *"No
  task — pick a card or General (LAI-758 is not a card you can see)"*.

## Acceptance criteria

- [x] **Right column:**
  - The order is **Draft my time** first, as a compact card with the switch,
    then On your plate, then Agent minutes.
  - On a laptop the column is sticky and **scrolls on its own**, within the
    viewport height. The page never runs on because of it.
  - Each On your plate group shows **at most 5** items, then "+N more", which
    leads to the right place: Inbox → Review for waiting-on-review, the
    board or List otherwise. Each group header keeps its true count.
- [x] **Drafted list, selecting:**
  - A **select-all** checkbox in the drafted section's header, and a
    checkbox on every row.
  - Select-all selects the current page. Once it is ticked, a link offers
    "Select all N drafted", for every page.
  - When anything is selected, a **bulk bar** shows how many and their total
    time, with **Confirm selected**, **General**, **Not work** and **Clear**.
  - Shift-click selects a range.
  - Everything works by keyboard and has labels.
- [x] **Bulk actions:**
  - They use the endpoints that exist: `POST /me/time-drafts/:id/confirm`,
    `/dismiss`, and `POST /me/time/days/:day/confirm` when the whole day is
    meant.
  - A block that cannot be confirmed as it stands, such as one with no
    visible card, is **left out of Confirm selected and named**: "2 need a
    card or General". It is never confirmed silently onto the wrong card.
  - Show progress. A partial failure leaves the failed rows selected and
    says why. A finished batch refreshes the day once, not once per row.
  - If a real server bulk endpoint turns out to be needed, the task stops
    and says so; it does not add one here (CLAUDE.md §5.1).
- [x] **Paging:**
  - The drafted list is **paginated**: about 10 rows per page, with "1–10 of
    37" and Prev/Next.
  - The list sits in a **bounded scroll area**, so the bulk bar and pager
    stay in view.
  - The confirmed list gets the same treatment, collapsed to a summary line
    when long.
- [x] **Simpler rows:**
  - One compact line: time range, duration, title.
  - A smaller meta line: replies, sessions, commits.
  - Per row, only **Confirm** and a "⋯" menu holding Card…, General,
    Minutes…, Split… and Not work. The menu is keyboard-operable and closes
    on Escape.
  - LAI-788's rule stays: an entry imported from Solidtime has no Edit or
    Delete.
- [x] **Overall:**
  - Remove visual noise: one heading per section, consistent spacing, and
    the week strip and day bar unchanged in behaviour.
  - Match `docs/design/` tokens.
  - Light and dark, laptop (1440) and phone (390). On a phone the right
    column stacks under the day and stays bounded.
- [x] **No hardcoded data.** Every count and title comes from the API.
- [x] **Tests that fail without the feature:**
  - select-all and range select;
  - the bulk confirm that leaves out and names a block with no card;
  - partial failure;
  - paging;
  - the 5-item cap with "+N more";
  - the right column's own scroll.
  - Prove at least two of these by mutation, confirming each mutation landed.
- [x] **Before/after screenshots** in `/tmp/laika-myday-shots/`, with a
      **busy-day fixture**: 40+ drafted blocks and 200 waiting on review.
- [ ] **Gate:** `pnpm test`, `pnpm lint` and `pnpm format`, each with its own
      exit code.

## Owner addition (2026-10-20)

Relayed by the orchestrator, folded into this task while it was in progress.
The owner's words: *"also if possible link that draft to the task as well,
everything must be connected if that is possible"*.

- [x] **Every row links to its card**, wherever the card is known: drafted
      blocks, confirmed entries, entries imported from Solidtime, and On your
      plate items.
  - The card key and title are a real `<a href>`, so middle-click and "open
    in new tab" work.
  - The link opens the task the way the rest of the app does — in its own
    space, LAI-755's route (`/board?project=…&task=…`, a key search when the
    space is not known). No new route.
  - Keyboard-accessible.
  - A card the person cannot see stays plain text with the existing
    explanation. Never a dead link.
- [x] **Suggested cards for "No task" blocks.** If the API already returns a
      hint for such a block (a branch, a commit, an outside id like LAI-NNN,
      or a suggested task), offer it as a one-click "Use LAIKA-123". The
      person still chooses; nothing is auto-assigned. If the API returns no
      hint, nothing extra is shown and the report says so.
- [x] **Time on the task side.** If an existing endpoint returns a task's
      confirmed time, the task panel shows a small "time logged" figure
      linking back to My day for that day. If none exists, no endpoint is
      added here: a follow-up task is filed in CHIEF's block (D-089) for the
      endpoint and the panel figure, and named in the report.
- [x] **Tests:** the link goes to the right task, and is not a link when the
      card is not visible; a suggestion test if the second item applies.

## Builder notes (2026-10-20, owner-direct)

Branch `LAI-810-my-day-bulk`, not pushed and no PR (the dispatch said so).

**What changed** — all in `server/web/src/routes/screens/my-day/`:
- `MyDayScreen.tsx`: the day card, then the drafted list, then the confirmed
  list, then Add time, each its own card with one heading. The column beside
  the day is Draft my time, then On your plate, then Agent minutes. One batch
  runner (`bulk`) re-reads the day once a batch.
- `DraftList.tsx` (new): select-all for the page, "Select all N drafted",
  Shift-runs, the bulk bar, progress and the batch's report, a bounded scroll
  area, and a pager.
- `EntryList.tsx` (new): the same paging; more than ten entries fold to a
  summary line until "Show them".
- `DraftRow.tsx` and `EntryRow.tsx`: one line each, with Confirm and a "⋯"
  menu (`MoreMenu.tsx`, new, wrapping the List's own `ListMenu`). An import
  from Solidtime gets History only (LAI-788).
- `draft-bulk.ts` (new): paging, range select, the confirm plan, the report
  wording and `runBulk`, with the API injected so it is unit-tested.
- `task-link.ts` and `CardLink.tsx` (new): the card as an `<a href>` by
  LAI-755's route (`/board?project=…&task=…`, or `/board?q=KEY` without a
  space). `OnYourPlate` now uses the same helper.
- `DraftMyTime.tsx` (new): the compact switch card; the long explanation and
  "Delete my drafts…" sit under "How it works".
- `plate-derive.ts`: `PLATE_CAP = 5`, `capped`, and `moreHref`. The rest
  link goes to Inbox → Review for review, and otherwise to the List of that
  space filtered to the reader (`status=in_progress` for in progress).
  `?ready=false` is not "blocked" (SPEC §4.5), so blocked gets no status
  filter.
- `AgentStrip.tsx`: each card links by key. `my-day.css`: the sticky,
  bounded column; rows divided rather than boxed; the scroll area, bulk bar
  and pager.

**Criteria that need a word:**
- *Bulk actions — endpoints.* Confirm uses `POST /me/time-drafts/:id/confirm`
  per block, or a single `POST /me/time/days/:day/confirm` when every block of
  the day is selected and ready. Not work uses `/dismiss`. **General uses
  `PATCH /me/time-drafts/:id`**, which already exists; the three named
  endpoints cannot move a block to General. No server endpoint was needed.
- *Not work* in bulk asks once ("Mark N as not work? They stay dismissed")
  because a dismissed block cannot be brought back from the UI.
- **The header's Confirm day changed behaviour.** Before, it confirmed every
  block, so blocks on nothing silently became General on the server. Now,
  when any block needs a card, it reads "Confirm 36 ready · 10:08", confirms
  only those one by one, and names the rest. When every block is ready it is
  still the single confirm-day request.
- *Known edge, unchanged from before:* the confirm-day request confirms what
  the server holds when it arrives. A block the collector uploads between
  the read and the click is confirmed as it stands.
- *Simpler rows, phone:* at 390 the title wraps onto a second line under the
  time and duration, so it is never cut off.
- *Owner addition, suggested cards:* **the API returns no usable hint.** A
  draft carries `task_key` only when the key names a card the reader cannot
  see; no branch, commit or suggested task reaches the client. Offering
  "Use LAI-758" would offer the very card the server just said is not
  theirs. Nothing extra is shown, and there is no suggestion test.
- *Owner addition, time on the task side:* **no endpoint returns a task's
  confirmed time** (checked `server/src/http/routes/time.ts` and SPEC §6.4).
  None was added. → **LAI-812** filed (CHIEF's block, D-089).
- LAI-797 and LAI-798 are unchanged in scope: no display-only fix in My day
  touches them. The evidence line LAI-797 would extend is now the row's
  meta line.

**Tests** (`server/web`):
- `node --test test/routes/screens/my-day/draft-bulk.test.ts
  test/routes/screens/my-day/task-link.test.ts
  test/routes/screens/my-day/plate-derive.test.ts
  test/routes/screens/my-day/my-day-derive.test.ts` → exit 0: 54 cases
  across 4 files. Per file: draft-bulk 17 (new), task-link 5 (new), plate-derive 14 (12 + 2), my-day-derive 18.
- `node --test test/browser/my-day-bulk.test.ts test/browser/my-day.test.ts`
  → 14 cases (10 new, 4 existing), all ok in the gate run.
- The fixture is `test/browser/my-day-busy.ts`: 42 drafts (6 on nothing, one
  of them LAI-758, which the reader cannot see) and 200 waiting on review.

**Mutations** — five, each confirmed landed (checksum changed, new text
grepped), run, then restored by checksum to the original; `git status` was
clean afterwards. Each red came from the intended assertion, with a clean
build:
1. `confirmPlan` lets untied blocks through → red: browser *Confirm selected
   leaves out…* (`d04/confirm` sent), plus two unit tests.
2. `PLATE_CAP = 500` → red: *five of each…* (`200 !== 5`).
3. `.myday-side` without `max-height`/`overflow-y` → red: *bounded,
   scrolling on its own* ("the column is 999.125px tall").
4. `CardLink` given `slug={undefined}` → red: *a known card is a link…*
   (`/board?q=LAI-1` ≠ `/board?project=atlas&task=t1`).
5. The Shift flag ignored → red: *Shift selects a run*.

**Gate** — repo root, after the last code edit:
`pnpm test > /tmp/l810-gate.txt 2>&1` → **TEST 0** (cli 530 pass 0 fail of
532; server 3279 passed, 10 skipped; server/web 2358 pass 0 fail).
`pnpm lint > /tmp/l810-lint.txt 2>&1` → **LINT 0**.
`pnpm format > /tmp/l810-fmt.txt 2>&1` → **FMT 0**.
A first `pnpm test` run, also after what I took to be the last edit, exited
**2** after 35 s. The web typecheck failed on my own new browser test
(implicit `any`), and pnpm stopped before the server suite ran. I fixed it in
9c963edc and ran the gate again from the start; the numbers above are that
second run. No LAI-768 or LAI-801 timeouts appeared (`master`'s LAI-768 fix
was merged in first).

**Screenshots** in `/tmp/laika-myday-shots/` (busy-day fixture):
`before-{light,dark}-{1440,390}.png` and `…-full.png`, and
`after-{light,dark}-{1440,390}.png`, `…-full.png` and `…-selected.png` (the
bulk bar). The whole page went from 10,805 px to 1,381 px at 1440, and from
20,292 px to 2,202 px at 390.

## Review round 1 (2026-10-20) — BLOCK

Relayed by the orchestrator. The "Bulk actions" criterion is unticked until
B1 is fixed.

- [x] **B1 (blocker): Confirm selected confirms what the server holds, not
      what was ticked.** With every block ticked, `runBulk` sent `POST
      /me/time/days/:day/confirm` (`draft-bulk.ts:178-187`) and reported the
      page's own ids. The server confirms every pending draft of the day, and
      an untied one as General (`server/src/services/time-drafts.ts:745-765`).
      A collector upload, every 600 s, deletes and re-inserts untouched
      pending drafts under new ids (`time-drafts.ts:341-375`). So after one
      upload, ticking all can confirm blocks nobody saw, or put a block on a
      card nobody chose, and those entries go to Solidtime.
  - Confirm selected always confirms block by block, by id; a stale id fails
    safely with a 404.
  - Confirm-day stays for the header button only. After it, the returned
    `entries` are compared with what the page planned; any difference is said
    plainly ("3 more blocks arrived since this page loaded and were confirmed
    too"), and the day is reloaded.
  - A test with a fixture where the server's day differs from the page's (an
    extra block on nothing): Confirm selected never sends confirm-day and
    never confirms the extra block. Proved by mutation, landed first.

Follow-ups, each small:
- [x] 1. The header path's report says "still selected" or "stay selected"
      when nothing is selected (`MyDayScreen.tsx:226`; assertion at
      `my-day-bulk.test.ts:367`). Word it for the header path.
- [x] 2. Stale ids: several `No draft "<id>"` 404s collapse into one sentence
      ("12 blocks changed since this page loaded — reloaded; please review
      again"), never "stay selected" when the reload removes them.
- [x] 3. A test proving bulk Not work asks first. A mutant that skipped the
      question stayed green in both browser files.
- [x] 4. During a batch, Add time and the week strip's day change are
      disabled, or the batch's progress and report are tied to its own day.
- [x] 5. Bulk General: ask once before moving blocks already on a card, or
      move only blocks on nothing. Pick one and say why.
- [x] 6. The header Confirm with some blocks needing a card stays partial,
      but its report says exactly how many were confirmed and how many left,
      and a `day_full` refusal (1440 minutes) part-way is said clearly.
- [x] 7. SPEC §11.4.2.1 (around `SPEC.md:4062-4069`) still says "Confirm day
      with the drafted total" and the old column order. Updated to match, as
      a named SPEC edit per D-033, that section only.
- [x] 8. Small items: remove the unused `.myday-subhead`
      (`my-day.css:115-122`); blocks with no set time get unique accessible
      names (duration or index); agent-minute rows (`agent-time.ts:166-178`)
      link a task only when the reader can read it, as drafts do; "+N more"
      across several spaces goes to a cross-space destination or says which
      space it opens.

Left as they are (non-blocking): card links take the space from the draft's
project.

## Builder notes, round 1 (2026-10-20)

**Gate is unticked.** This round's one repo-root run was **TEST 1**, LINT 0,
FMT 0. The only failure was `server/test/tooling/build.test.ts`, *"produces
an identical tree on a second run"*, timing out at 120 s: one of LAI-768's
load-timeout files, which this branch does not touch. The machine was at a
load average of 12 to 42 with another builder running. Re-run alone,
`npx vitest run test/tooling/build.test.ts` (in `server/`): 16 of 16 passed,
exit 0, in 112.8 s. Both runs are reported, and per the dispatch the Gate line
stays unticked unless TEST is 0.

**B1.** *Confirm selected* now always confirms block by block, by id
(`runBulk` in `draft-bulk.ts`), however many are ticked. It never sends
`POST /me/time/days/:day/confirm`. A block that changed since the page loaded
answers 404 and is not replaced by anything. Confirm-day stays for the
header button, only when every block on the page is ready
(`runConfirmDay`). What comes back is compared with the page (`dayReport`):
more blocks, fewer blocks, other minutes, or a block on no card now General
are each said, and the day is reloaded.

**The other items:**
1. **Header wording.** The header path has its own report and never says
   "selected": "Confirmed 36 of 42 blocks; 6 left drafted — 6 need a card or
   General (…)".
2. **Stale ids.** 404s become one sentence: "N blocks changed since this page
   loaded — reloaded; please review again". They are not kept selected.
3. **Not work** asks first. A new browser test catches the reviewer's mutant
   (see below).
4. **During a batch,** Add time, the week arrows, the other days and *Today*
   are disabled. The batch's progress and report carry its day and show only
   on that day.
5. **General asks once** when any ticked block is on a card or a space: "N of
   these are on a card or a space — move them to General too?", with *Move
   all*, *Only the K on nothing*, and *Keep them*. I chose asking over
   refusing because moving many blocks the collector put on the wrong card is
   a real correction, and refusing would force it row by row. Blocks only on
   nothing move at once, and ticked blocks the batch did not touch stay
   ticked.
6. **The header with blocks needing a card** is still partial. It says how
   many were confirmed and how many were left, and why. A `422 day_full`
   stops the pass at that block in both paths, and the report names the
   block where it stopped and counts the rest as not confirmed.
7. **SPEC §11.4.2.1, the My day entry only,** is rewritten to match
   (fcc7cdc9).
8. **Small items:**
   - `.myday-subhead` is removed.
   - Blocks and entries with no set time are named "block 3 of 42, no set
     time, 0:15".
   - Agent-minute rows link only when the card's key prefix is a space the
     reader can read. `GET /projects` lists only those, and prefixes are
     unique per organisation. It is read once for the page and shared with
     On your plate. An unreadable card shows as "SEC-9 (not a card you can
     see)", without its title.
   - "+N more" spanning several spaces gives one link per space, naming it
     ("+3 in Atlas", "+2 in Onroute").

**Discovered:** the server still sends those unreadable titles in `GET
/me/time`'s `by_task` → **LAI-816** filed (CHIEF's block, D-089).

**Tests** (in `server/web`, one file at a time):
- **Unit,** `node --test test/routes/screens/my-day/<file>.test.ts`, every
  file exit 0: task-link 7, plate-derive 18, draft-bulk 25, my-day-derive 18,
  day-timeline 12. That is 80 cases across 5 files.
- **Browser,** `node --test --test-concurrency=1 test/browser/my-day-bulk.test.ts`
  → 17 cases, exit 0. `test/browser/my-day.test.ts` → 4 cases, exit 0.
  - The new cases are: B1 (the server's day holds an extra block on nothing,
    and Confirm selected sends only the page's ids), stale ids, the header's
    confirm-day with a differing server day, the header's partial report,
    `day_full` part-way, Not work asks first, General asks, mid-batch locks,
    and untimed names.

**Mutations,** six, each confirmed landed (checksum changed, new text grepped;
the Not work mutant carried a unique marker), then restored by checksum.
`git status` was clean afterwards. Each red was its intended assertion, with
a clean build:
1. `runBulk` sends confirm-day when every ticked block is ready → red: B1
   browser ("Confirm selected confirmed the day") and its unit test.
2. Not work skips the question → red: *Not work asks first*. The 4 older My
   day cases stayed green, which is the gap the reviewer found.
3. General skips the question → red: *General asks before…*.
4. Stale 404s kept selected → red: "3 selected · 0:51" ≠ "1 selected · 0:18",
   plus the unit test.
5. An unreadable agent card linked → red: 7 links ≠ 6.
6. Add time not locked → red: "time can be added mid-batch".

`master` was merged in (72344c83: decisions, logs and task files only) before
the gate.

## Accepted (CHIEF, 2026-10-20)

Review round 2: APPROVE (review-my-day-bulk).
- B1 is fixed: no bulk-bar path reaches confirm-day. A stale id gets a 404
  and nothing is confirmed in its place.
- All eight round-1 follow-ups are done.
- The reviewer's mutant that put confirm-day back into Confirm selected went
  red.

Any unticked Gate line was settled by CHIEF's root run on master right after
this commit; the result is in `logs/chief-2026-10-20.md`.

Carried to LAI-820, which is still in backlog:
- the header's day report misses a block moved to another card with the same
  count and minutes;
- no test pins the exact key-prefix match (LAI against LAIKA);
- "Only the K on nothing" can overstate K;
- the other-day lock check is skipped on Mondays.
