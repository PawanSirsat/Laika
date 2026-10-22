## 2026-10-22T09:13:00Z — LAI-865

A Claude Code builder worked this task on Belka, in the worktree
`Laika-block-title` on branch `LAI-865-type-a-title-on-a-to-settle-block`. The
branch was cut from `origin/master` 9250fc3e, which carries LAI-866. CHIEF
(polly) dispatched it. Board card LAIKA-676.

**What changed**
- server/src/http/routes/time.ts: `DraftPatchBody` takes `note`, at most 200
  or `null`. The comment gives the reason: the draft CHECK,
  `time_drafts_note_check`.
- server/src/services/time-drafts.ts: `DraftPatch.note`; `updateDraft`
  trims it, makes a blank one `null`, and holds the block (`collectorId: ''`)
  as for every edit.
- server/test/http/routes/time-my-day-v2.test.ts: seven cases covering
  confirm alone, confirm the day, trim and blank, the 200 cap, the
  collector's next upload, General keeping the title, and Undo.
- server/test/services/time-drafts.test.ts: three cases.
- server/web/src/api/time.ts: `DraftPatch.note`.
- server/web/src/routes/screens/my-day/shortcuts.ts: the `'title'` shortcut
  on T, and the sheet's row.
- server/web/src/routes/screens/my-day/Inspector.tsx: `TitleField` as a row
  under the drafted block's head, the saved title in the head, and T in the
  hint row.
- server/web/src/routes/screens/my-day/DraftRow.tsx: the title on the To
  settle row.
- server/web/src/routes/screens/my-day/MyDayScreen.tsx: `setTitle` with a
  toast and Undo, and T focusing the field.
- server/web/src/routes/screens/my-day/my-day.css: `.inspector-title`,
  `.inspector-said` and `.myday-row-title`, existing tokens only.
- server/web/test/browser/my-day-title.test.ts (new),
  server/web/test/routes/screens/my-day/shortcuts.test.ts and
  server/web/test/api/time.test.ts.
- docs/SPEC.md: the four named lines (D-033/D-034): §4.47 `note`, §6.4's
  PATCH body and *The person's hands*, and §11.4.2.1 My day.
- .tasks/review/LAI-865-type-a-title-on-a-to-settle-block.md.

**Decisions**
- The field is in the inspector, not on the row. In LAI-831 the row selects
  and the inspector acts, and a text field in a row would not fit 390 px.
  The row shows the saved title as one line cut with an ellipsis.
- After ↵ saves, the focus goes to the inspector's `section`, which has
  `tabIndex -1`. It does not go to `body`, so it stays by the block, and the
  next ↵ confirms because a `SECTION` is not in `ACTS_ON_ENTER`.
- `TitleField` is keyed on the saved note. A save or an Undo then starts the
  field from what the server holds, and a failed save keeps what was typed.

**Discovered**
- A placeholder beginning "What it was" collides with
  `getByPlaceholder(/What it was/)` in `my-day-v2.test.ts:724` (Add time),
  which runs with a draft selected. Changed before review.
- A save whose title changes remounts the field. Before the remount, focus
  is already on the inspector, which is why the ↵-leaves mutation was caught
  only by the assertion made straight after ↵. The G case passed under it,
  because by then the remount had dropped the focus to `body`.
- The gate's results are in the PR and in `finish_task` on LAIKA-676. This
  entry is written before the gate, so the gate runs last before the push.
