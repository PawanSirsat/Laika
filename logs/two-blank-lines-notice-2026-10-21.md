## 2026-10-21T17:30:00Z — LAI-854 (built on Strelka)

**What changed**
- server/web/src/routes/screens/task/editor/markdown-bridge.ts — `parseMarkdown`
  drops an empty paragraph inside a block (`withoutEmptyParagraphs`), so two
  blank lines between list items no longer read as one in the first item;
  `inWords` counts a removed run of blank lines; `explain` asks
  `leftContainer` before the generic notice, naming the line a Unicode-blank
  line pushes out of a list item or quote; `TextBlock` carries the token type
- server/web/test/routes/screens/task/editor/markdown-bridge.test.ts — one
  `describe`, 6 cases from 4 `test()` calls: both layouts' notices, the parse,
  and a guard for after a real blank line
- .tasks/review/LAI-854-a-list-with-two-blank-lines-gets-a-vague-notice.md —
  Result, Evidence; the gate criterion is left unticked
- .tasks/backlog/LAI-306-unicode-blank-line-after-a-blank-gets-a-vague-notice.md — filed
- .tasks/backlog/LAI-308-activity-sync-time-zone-lock-test-reads-an-empty-lock.md — filed

**Decisions**
- Layout 1 stays Markdown, not rich — the editor writes lists tight, and
  CommonMark reads `- a\n\n\n- b` as loose, so opening it would change how the
  board renders it on the first edit.
- Fix the parse (drop the phantom empty paragraph) instead of special-casing
  the notice — then the draft is what the editor would really write, and the
  existing diff names the blank lines, as it already does for one blank line.
- Only nested empty paragraphs are dropped, not top-level ones — `blocksOf`
  already ignores those, and the editor's opening content stays as it was. A
  mutation shows nothing asserts this narrowing; it is in the Evidence.
- `leftContainer` runs only when the diff finds nothing — a named rewrite
  elsewhere stays the first thing said, and no existing notice moves.
- Log file named for the task, not `shell-`/`strelka-` — parallel branches
  creating the same new log path add/add-conflict at merge.

**Discovered**
- `Intro:\n- a\n\n<U+00A0>\nB` still gets the generic notice →
  LAI-306 filed (discovered-from: LAI-854).
- cli `activity-sync.test.ts:717` waits for the lock file to exist, then reads
  it, and once got `''` → LAI-308 filed (discovered-from: LAI-854).
- `task-markdown.test.ts:226` link-popup timeout, twice in five gates — already
  filed as LAI-307 by LAI-857's builder minutes earlier; not refiled.
- `sprints.test.ts:623` timed out twice — LAI-304, already filed.
- `gh` on Strelka has the work account active; pushes used
  `GH_TOKEN=$(gh auth token --user PawanSirsat)` per command rather than
  switching the global active account under other sessions.
- Trial merge with LAI-853 (`8692850d`): two conflicts in `parseMarkdown`, both
  "each branch adds a JSON pass"; compose them
  `withoutLineIndents(withoutEmptyParagraphs(…), schema)` → 124/124, tsc 0.

**State**
In review. Gate: LINT 0, FMT 0; TEST 1 in all five runs, each on one known or
filed load flake that passes alone. The gate criterion is not met and is not
ticked.
