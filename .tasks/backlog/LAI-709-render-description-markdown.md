---
id: LAI-709
title: 'The task view renders its description and acceptance as markdown'
area: web
assignee: unclaimed
priority: p1
depends-on: []
status: backlog
---

## Goal

The owner, 2026-10-07, with a crop of ONR-331: *"in desc that not looks good
that * showing as it is that must look properly render like the header and
all"*. The field is `description_md`, and teams and agents write it in
markdown: `## headings`, `**bold**`, tables, `` `code` ``, lists. The task view
prints it as raw text, so a long HLD is unreadable.

## Acceptance criteria

- [ ] The task view's Description and Acceptance render as GitHub-flavoured
      markdown: headings, bold and italic, inline and fenced code, ordered
      and unordered lists, task lists, tables, blockquotes, rules and links.
- [ ] **No raw HTML ever renders.** `<script>`, `<img onerror>` and the like
      in a description show as text or are dropped, never as elements. A
      `javascript:` link is not a working link. Images are not loaded: SPEC
      §13.4 is a self-hosted board that makes no third-party requests, so an
      image shows its alt text.
- [ ] Links open in a new tab with `rel="noopener noreferrer"`. Clicking a
      link follows it and does not open the editor.
- [ ] Editing is unchanged: clicking the rendered description opens the same
      textarea with the raw markdown. A keyboard user can still reach the
      editor.
- [ ] Styles come from existing tokens, in both themes. Headings sit below
      the panel's own section headings. Tables scroll sideways inside the
      column rather than widening the panel. Every size respects LAI-706's
      10px floor.
- [ ] Browser tests cover a markdown description (heading, strong, table,
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
