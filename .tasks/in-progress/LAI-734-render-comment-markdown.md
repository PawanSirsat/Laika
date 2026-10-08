---
id: LAI-734
title: 'Comments render as markdown, the same way the description does'
area: web
assignee: chief
priority: p1
depends-on: [LAI-709]
started: 2026-10-08T19:45:37Z
status: in-progress
---

## Goal

The owner, 2026-10-09, with a screenshot of the task panel (ONR-305): comment
bodies print raw markdown. Literal `**Progress…**`, backtick code, `- [ ]`
checklists, `- bullets`, and blank-line paragraphs collapsed. The description
already renders through `TaskMarkdown` (LAI-709); comments still go through
LAI-284's fences-only `splitFences`.

## Acceptance criteria

- [ ] A comment body renders through the same renderer as the description:
      bold, italics, inline and fenced code, bullet and numbered lists, task
      lists (read-only checkboxes), links, paragraphs and line breaks. No new
      dependency.
- [ ] What LAI-284 gave comments survives: a fenced block is still a
      `.comment-code` element carrying its `data-language`, an unclosed fence
      still runs to the end, and an `@`-mention is still the author's text.
- [ ] The safety path is the description's: no `innerHTML`, no raw HTML
      elements, `javascript:` and `data:` links neutralised, links open in a
      new tab with `rel="noopener noreferrer"`, images not loaded. A
      `[x](javascript:alert(1))` comment and a raw `<img onerror>` comment
      render inert, under test.
- [ ] Styled for the thread: body text size, compact spacing, code chips and
      blocks from theme tokens in light and dark. A long code line scrolls
      inside its block and does not widen the panel.
- [ ] Browser tests assert bold, inline code, a list and a checkbox are
      elements inside a comment, and each fails on the old renderer.

## Notes / context

Owner-directed, filed and built by CHIEF under the owner's instruction.
Reverses LAI-709's *"Comments keep LAI-284's fences-only rule"* on the owner's
word. `react-markdown` and `remark-gfm` are already dependencies (LAI-709);
nothing is added.
