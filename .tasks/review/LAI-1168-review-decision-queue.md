---
id: LAI-1168
title: 'Inbox → Review: for you to decide, grouped by space, bulk Accept, badge counts decidable (D-146)'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-11-10T06:20:00Z
finished: 2026-11-10T08:30:00Z
---

## Goal

The Review tab is the organisation's whole review queue drawn flat, rows the
reader cannot decide included with disabled buttons, and the sidebar's Inbox
badge counts that pile. The owner decided (2026-11-10, D-146): Review opens on
**For you to decide** (`can_decide`), grouped by space; **Everything in
review** is a read-only toggle at `?view=all`; checkboxes and a bulk bar
**Accept N** (one request per task, progress, refusals); the Inbox badge and
the Review tab count only what the reader can decide. Capacity's tile keeps
the whole queue. Web only; no server change. This is PR A of three — the
dialog, the hand-offs fold and the *Accept* wording are LAI-1169; Work as an
Organisation tab is LAI-1170. The rows keep today's inline expand until
LAI-1169 replaces it. Board card LAIKA-1031 (`external_ref: LAI-1168`).

## Acceptance criteria

- [x] `routes/screens/review/review-derive.ts` (pure): `reviewView(params)`
      → `'mine' | 'all' | 'handoffs'` (default `mine`), `withView`,
      `visibleQueue(items, { decidable, filter })` (`filterQueue` then
      `can_decide`, server order kept), `groupBySpace` → `SpaceGroup
      { project, items, decidable }` in order of first appearance,
      `flatOrder`, `acceptSummary`. `decidableCount` beside `filterQueue` in
      `api/review.ts` (api/ imports nothing from routes/).
- [x] `ReviewScreen` takes `params`/`setParams`; the view toggle is first in
      the filter row, two `aria-pressed` buttons *For you to decide (N)* ·
      *Everything in review (M)*; `?view=all` in the address, `mine` omitted;
      the filters and *Clear filters* keep the view; the header reads
      *N for you to decide · M in review[ · first 200]*; the tiles count the
      open view and the caption says which.
- [x] `ReviewGroups.tsx`: a section per space with name, count and a
      select-all checkbox (`indeterminate` for a partial group); a
      `checkbox-input` outside the row button (`aria-label="Select LC-1"`) on
      every `can_decide` row, an empty cell otherwise; a non-decidable row's
      expand shows *Open on board* and why, no Accept / Send back.
- [x] Selection is a `ReadonlySet<string>` through `list/list-select.ts`,
      pruned to visible decidable rows (`effectiveSelection`), cleared on a
      view change.
- [x] `ReviewBulkBar.tsx`: *N selected · Accept N · ×*, `position: sticky;
      bottom` inside `.rev`, `rev-bulk-*` tokens-only CSS; the run is
      `applyToEach(ids in page order, acceptReview, progress)` from
      `list/list-bulk.ts`; `phase: 'done'` carries `acceptSummary` and
      refusals `{ key, message }`; the refused ids stay selected; `load()`
      and `onChanged()` follow; checkboxes and buttons disabled while
      running; `Spinner`, no label swap.
- [x] `api/use-review-count.ts` returns `decidable`; `ShellValue` gains
      `reviewDecidable`; `ShellSidebar` passes it to `inboxCount`;
      `InboxRoute` passes it as the Review tab's count; Capacity keeps
      `reviewWaiting`; My day already filters `can_decide`.
- [x] Tests: `test/routes/screens/review/review-derive.test.ts` (new);
      `decidableCount` in `test/api/review.test.ts`;
      `test/browser/review.test.ts` rewritten in place with a second space
      and a `can_decide: false` row — grouped default, toggle and `?view=all`,
      the empty "nothing for you" state, tab count and badge = decidable,
      group select-all + Accept N with one `403` refusal (calls in page
      order, progress line, report names `LC-3 — …`, accepted rows detached,
      refused still ticked, badge follows), both themes at 1440 and 390; the
      existing accept / send-back / order / cue assertions kept.
      `spaces-sidebar.test.ts` stub gains `can_decide: true`.
- [x] Mutation checks run and recorded in the log: the `can_decide` filter
      removed → the grouped-default test red; `applyToEach` fanned out →
      the order assertion red.
- [x] Docs: SPEC sidebar row (`the sidebar`), the Inbox row, and the Inbox /
      Review §11.4.2.1 entries; D-146 appended to `docs/DECISIONS.md`
      (amends D-082 item 7; records the six decisions and three judgement
      calls; LAI-1169 referenced).
- [x] Both themes; tokens only; strict TS; no new dependency.

## Notes

- Deviation from the plan, stated: in *Everything in review* a decidable row
  still has its checkbox, so the bar works there too; only rows the reader may
  not decide are read-only. "Read-only" in the plan is read as "the rows you
  cannot decide", not "the view".
- The tiles count the open view *before* the filters (the filters narrow the
  list, the tiles say what the view holds), as the `[data-stat="check"]`
  assertion in the cue test relied on.
- The bulk bar's progress line is held in the test with `page.route` on one
  accept (the stub server answers synchronously), and the route is removed
  with `unrouteAll` before the page closes.

## Review log

(CHIEF appends here.)
