---
id: LAI-734
title: 'Comments render as markdown, the same way the description does'
area: web
assignee: chief
priority: p1
depends-on: [LAI-709]
finished: 2026-10-08T20:01:08Z
started: 2026-10-08T19:45:37Z
status: done
---

## Goal

The owner, 2026-10-09, with a screenshot of the task panel (ONR-305): comment
bodies print raw markdown. Literal `**Progress…**`, backtick code, `- [ ]`
checklists, `- bullets`, and blank-line paragraphs collapsed. The description
already renders through `TaskMarkdown` (LAI-709); comments still go through
LAI-284's fences-only `splitFences`.

## Acceptance criteria

- [x] A comment body renders through the same renderer as the description:
      bold, italics, inline and fenced code, bullet and numbered lists, task
      lists (read-only checkboxes), links, paragraphs and line breaks. No new
      dependency.
- [x] What LAI-284 gave comments survives: a fenced block is still a
      `.comment-code` element carrying its `data-language`, an unclosed fence
      still runs to the end, and an `@`-mention is still the author's text.
- [x] The safety path is the description's: no `innerHTML`, no raw HTML
      elements, `javascript:` and `data:` links neutralised, links open in a
      new tab with `rel="noopener noreferrer"`, images not loaded. A
      `[x](javascript:alert(1))` comment and a raw `<img onerror>` comment
      render inert, under test.
- [x] Styled for the thread: body text size, compact spacing, code chips and
      blocks from theme tokens in light and dark. A long code line scrolls
      inside its block and does not widen the panel.
- [x] Browser tests assert bold, inline code, a list and a checkbox are
      elements inside a comment, and each fails on the old renderer.

## Notes / context

Owner-directed, filed and built by CHIEF under the owner's instruction.
Reverses LAI-709's *"Comments keep LAI-284's fences-only rule"* on the owner's
word. `react-markdown` and `remark-gfm` are already dependencies (LAI-709);
nothing is added.

## Build notes (CHIEF, under the owner's instruction)

- `CommentBody` now renders through `TaskMarkdown`, with `className="md-comment"`
  and one extra renderer: `pre` becomes LAI-284's `.comment-code` box with the
  fence's tag as `data-language`. `TaskMarkdown` merges caller components
  **under** its own `a`, `img` and `table`, so no caller can replace the link
  or image rule.
- `comment-body.ts` (`splitFences`) and its unit test are deleted: nothing
  else imported it, and CommonMark already gives the two behaviours it
  existed for (fenced code, an unclosed fence running to the end).
- A single newline in a comment stays a line break, as it was under the old
  `pre-wrap` body: `.md-comment p { white-space: pre-line }`. CSS, not a
  second parse; paragraphs only, because a list item holds the renderer's
  newline text between blocks. Mutation-checked: with the rule set to
  `normal`, the line-break assertion goes red on exactly that line.
- `@`-mentions: `comment-body.ts` never did anything with them (the server
  parses mentions from the body). They stay as the author's text, asserted.
- `test/browser/comment-markdown.test.ts`, three tests. On the old renderer
  two are red (elements; javascript:/raw-HTML inertness) and one is green
  by design: it guards that the fence is still `.comment-code` with
  `data-language`, and that a long code line scrolls inside the drawer.
- Screenshots: `/tmp/laika-ui-comment-md-shots/{before,after}-{light,dark}.png`.

## Accepted

2026-10-09, by polly (orchestrator), for release 4. Review: APPROVED by
independent review. Integrated on `build-release-4`; the only conflict was
`logs/chief-2026-10-09.md`, resolved by keeping every entry in timestamp
order. The last fix round (4444430, hard breaks and
thread-sized headings) is under a quick security re-check at accept time.
