---
id: LAI-705
title: 'Priority is drawn as Jira draws it — an up chevron, an equals sign, a down chevron'
area: web
assignee: chief
priority: p2
depends-on: []
status: done
closed: 2026-10-07T07:57:56Z
started: 2026-10-07T07:40:28Z
finished: 2026-10-07T07:55:51Z
---

## Goal

The owner's two crops of Jira's priority icons, 2026-10-07: *"for priority use
this kind of icon properly"*. A red chevron up, an orange equals sign, a blue
chevron down (and Jira's doubled chevrons at the extremes). Laika draws a
coloured dot on the card and the text `P1` in the List and the task view.

## Acceptance criteria

- [x] One `PriorityIcon` component draws Laika's three levels as Jira draws
      the middle three: **P1 a red up chevron (High), P2 an orange equals sign
      (Medium), P3 a blue down chevron (Low)** — an inline SVG in
      `currentColor`, its name in a `<title>` and a visually-hidden label, so
      the colour is never the only signal.
- [x] It replaces the priority dot on the card, sits beside the `P1` text in
      the List's PRI column, and beside the priority control in the task
      view's Details card.
- [x] Colours come from existing tokens only (D-020): `--overdue` for P1,
      `--chip-orange` for P2, `--chip-blue` for P3. Both themes.
- [x] Browser tests: each level draws its own glyph and name on the card, the
      List and the task view; a P3 card no longer draws a dot.

## Notes / context

Owner-directed, filed and built by CHIEF. **Three levels, not Jira's five.**
`TASK_PRIORITIES` is `p1 | p2 | p3`, shared by the REST API, the policy layer
and the MCP tools that agents call; adding Highest and Lowest is a schema and
tool-contract change for every owner, and the owner asked for the icons, not
the levels. D-070 records the mapping.

## Built

Code commit `2531f54`, on branch `build-icons` (cut from `build-list` at
`1a4c453`).

**Component.**
- `server/web/src/components/PriorityIcon.tsx` exports `PriorityIcon({ priority, size? })`,
  `PRIORITY_NAMES` (`p1` High, `p2` Medium, `p3` Low) and `PRIORITY_GLYPHS`. It is an
  inline 16-unit SVG with `stroke="currentColor"`, `fill="none"` and round caps, at
  14px by default.
- `server/web/src/components/priority-icon.css` holds the per-level colours:
  `--overdue`, `--chip-orange` and `--chip-blue`. All three are defined in
  `theme.css` for dark `:root` and for `[data-theme='light']`.

**Deviation on criterion 1, stated rather than hidden.** The name is in a `<title>`
and in the SVG's `aria-label` with `role="img"`. There is no separate
visually-hidden span, because the label and the span together would make a screen
reader announce the level twice. The card's old visually-hidden "Priority p1"
is gone with the dot.

**Where it is drawn.**
- **Card.** `TaskCard.tsx` draws the icon where the dot was, still behind
  `fields.priority`. In `board.css`, every `.card-dot` rule is removed, and the
  footer's no-shrink rule now names `.priority-icon`. The icon is centred on the
  key's line.
- **List.** `ListView.tsx` draws the icon before `P1`. `list-derive.ts` gains
  `priorityLevel`. In `list.css`, PRI grows from 2.625rem to 3.625rem (42px to
  58px), and the table's min-width grows by the same 1rem, so Summary keeps its
  room.
- **Task view.** `TaskMeta.tsx` draws the icon before the Priority select, outside
  its `<label>`, so the select is still named "Priority" alone. It is inline,
  not a flex row: a flex row clipped `P2` to `P`, as explained in
  `task-panel.css`.

**Tests.**
- `test/browser/priority-icons.test.ts` is new and checks the card, the List and
  the task view, each in dark and light. For every level it checks the shape
  from the path's geometry (up, equals or down), the `aria-label` and the
  `<title>`, and the computed colour against that level's token. It also checks
  that the three colours differ.
- The same file checks that no card draws `.card-dot`, behind a positive
  control. It also checks that the icon is centred on the key and on the select,
  that PRI is 58px and does not wrap, and that the select is as wide as it is
  without the icon.
- `test/components/priority-icon.test.ts` is new. It checks the names, three
  distinct glyphs and the chevron directions at source. It also checks
  `role`, `aria-label`, `<title>` and `currentColor`, and the tokens in both
  theme blocks with no literal colour.
- `view-settings.test.ts` is re-aimed from `.card .card-dot` to
  `.card .priority-icon`.
- `card-footer.test.ts` now reads the footer's classes by attribute, because an
  `<svg>`'s `className` is not a string. This was red until the fix.
- In `list-view.test.ts`, only the comment naming PRI 42 is re-aimed. The width
  was never asserted there, and it is asserted in the new file.

**Mutations.** Each was applied with `cp`, its anchor was confirmed, and it was
restored with `cp` and checked by checksum.
- `p3` drawing the up chevron turns the card, the List and the task view red:
  "p3 should draw down, drew up".
- `p2` wearing the `p1` colour class turns all three red: "p2 is not
  --chip-orange".
- The flex row put back in `task-panel.css` turns the task view red: "the
  select is 39px beside the icon, 47px alone".

**Gate**, each run on its own with its exit code read.
- Web typecheck exits 0.
- Web `pnpm test` exits 0, with 1237 of 1237 passing.
- Repo-root `pnpm test` exits 0: server 2099 of 2099, web 1237 of 1237, cli 85
  of 85.
- `pnpm lint` exits 0.
- **`pnpm format` exits 1, on `server/web/src/routes/screens/board/LaneRow.tsx`
  only.** That file is already unformatted at the base commit `1a4c453`
  (LAI-473, from `build-list`), and this task does not touch it.
  `pnpm format:fix` diffs against `master`'s merge base, so it reformatted that
  file too. The file was restored from `HEAD` by name. The formatting belongs to
  LAI-473.

## Review

Accepted 2026-10-07T07:57:56Z by CHIEF, built by one agent on the owner's instruction
(*"that priority icon I want in the List as well"*). Screenshots of the card,
the List and the task view in both themes were looked at: red up chevron,
orange equals, blue down chevron, each beside its text. The criterion's
visually-hidden label was dropped for the SVG's own `aria-label`, so a screen
reader hears the level once — accepted. The List's PRI column grew by 1rem and
the table's minimum width with it. Found from its screenshot: LAI-710.

