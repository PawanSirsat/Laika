---
id: LAI-709
title: 'The task view renders its description and acceptance as markdown'
area: web
assignee: chief
priority: p1
depends-on: []
finished: 2026-10-07T07:33:13Z
started: 2026-10-07T07:27:28Z
status: review
---

## Goal

The owner, 2026-10-07, with a crop of ONR-331: *"in desc that not looks good
that * showing as it is that must look properly render like the header and
all"*. The field is `description_md`, and teams and agents write it in
markdown: `## headings`, `**bold**`, tables, `` `code` ``, lists. The task view
prints it as raw text, so a long HLD is unreadable.

## Acceptance criteria

- [x] The task view's Description and Acceptance render as GitHub-flavoured
      markdown: headings, bold and italic, inline and fenced code, ordered
      and unordered lists, task lists, tables, blockquotes, rules and links.
- [x] **No raw HTML ever renders.** `<script>`, `<img onerror>` and the like
      in a description show as text or are dropped, never as elements. A
      `javascript:` link is not a working link. Images are not loaded: SPEC
      §13.4 is a self-hosted board that makes no third-party requests, so an
      image shows its alt text.
- [x] Links open in a new tab with `rel="noopener noreferrer"`. Clicking a
      link follows it and does not open the editor.
- [x] Editing is unchanged: clicking the rendered description opens the same
      textarea with the raw markdown. A keyboard user can still reach the
      editor.
- [x] Styles come from existing tokens, in both themes. Headings sit below
      the panel's own section headings. Tables scroll sideways inside the
      column rather than widening the panel. Every size respects LAI-706's
      10px floor.
- [x] Browser tests cover a markdown description (heading, strong, table,
      code, link) rendering as those elements; a `<script>` and a
      `javascript:` link staying inert; and click to edit still showing the
      raw source.

## Notes / context

Owner-directed, filed and built by CHIEF under the owner's instruction.

**This task names two new dependencies, as CLAUDE.md §5 requires:**
`react-markdown` (^10, supports React 19) and `remark-gfm` (^4, for tables and
task lists). They are not hand-rolled. A renderer of eight constructs is a
parser to maintain and test. `react-markdown` builds React elements, not an
HTML string, does not render raw HTML unless `rehype-raw` is added (it must
not be), and passes every URL through `defaultUrlTransform`.

Comments keep LAI-284's fences-only rule. A comment is a different surface,
and the owner asked about the description.

## Build notes (CHIEF, under the owner's instruction)

- `TaskMarkdown.tsx` + `task-markdown.css`: `react-markdown` 10.1 with
  `remark-gfm` 4. Links get `target=_blank` and `rel="noopener noreferrer"`.
  Images become their alt text. Tables are wrapped in a sideways scroller.
  Heading sizes run from 14.5px down to 13px, below the 15px section
  headings.
- `InlineEdit` takes an optional `render`. With it, the view is a `<div>`
  rather than a `<button>`, because headings and tables are not allowed
  inside a button. The block takes the mouse click, except on a link or a
  checkbox, or when the click ends a text selection. A real
  `Edit description` button, shown on hover and on focus, carries keyboard
  access and the accessible name. The title does not pass `render` and is
  unchanged.
- **Measured, not assumed:** a raw HTML line in markdown opens an HTML block
  that swallows every line after it up to the next blank line. It renders as
  escaped text, so it is safe, and the test fixture keeps blank lines
  between its hostile lines so that each one is actually exercised. A
  `javascript:` link renders as `<a href="">`.
- **Mutations:** dropping `rel`, and dropping `remark-gfm`, each turn
  `task-markdown.test.ts` red. It is green when restored.
- **Seen:** an ONR-331-shaped HLD (headings, bold, a 4-row table with
  inline code, an ordered list, a task list, a quote, a code block and a
  link) on a seeded local instance, in both themes.
- Long inline paths inside table cells break mid-word
  (`app/(operator)/adm|in/login`). That is the `overflow-wrap: anywhere`
  which stops one long path from widening the panel.
