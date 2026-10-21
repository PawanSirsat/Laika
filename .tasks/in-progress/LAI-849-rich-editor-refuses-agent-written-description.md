---
id: LAI-849
title: 'The rich editor refuses an agent-written description, saying it would rewrite line 7 as an empty line'
area: web
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-827
status: in-progress
started: 2026-10-21T06:52:18Z
---

## Goal

An agent-written description that renders correctly opens in the rich editor.
When the editor genuinely cannot keep a description intact, the notice says
what would change.

## What the owner saw (2026-10-21, 08:58)

The task panel for an agent-written task in another project showed:

> This Markdown stays as Markdown. The rich editor would rewrite line 7:
> '- <the first item of a bulleted list>…' as ''

and the editor toolbar was greyed out. The owner's words: *"why I'm not able
to edit here using the tool"*. The screenshot is on this machine at
`~/.omnigent/artifacts/2880e3a1c1e14ba7a4b20fbd670faa4a`; it is not in the
repo.

(The quoted list item is the owner's text from another project and is
elided here: this repo is public.) The notice comes from LAI-827's
round-trip guard:
`server/web/src/routes/screens/task/editor/markdown-bridge.ts:730` and
`server/web/src/routes/screens/task/editor/RichEditor.tsx:513` (line numbers as
of `master` `d36d2ee5`).

## Hypothesis: unverified, prove or refute it first

The guard converts the stored Markdown into the editor's document and back,
and refuses when the result differs. If it compares the two texts line by line
by position, one inserted blank line shifts every later line, and the first
mismatch reads as *"line N becomes ''"*.

A bullet list placed directly under a paragraph with no blank line between them
is common in agent-written Markdown, is legal CommonMark (a list may interrupt
a paragraph), and is a likely source of exactly one inserted blank line.

If that is right, the guard refuses a change that alters no rendered content,
then describes it wrongly. If it is wrong, find what really changes: the cause
may be the serializer losing real content, and then the fix belongs in the
bridge, not the guard.

## Acceptance criteria

- [ ] The root cause is stated in the Result section with evidence: the input
      shape, what the round trip produced, and the code that compared them.
- [ ] A regression test reproduces the refusal on `master` with a
      **synthetic** description of the same Markdown shape, and passes after
      the fix. **This repo is public: no text, task key, or name from the
      owner's other projects goes into any fixture, commit, log or PR.**
- [ ] The description shape the owner hit opens in the rich editor. If the
      round trip genuinely loses content that cannot be kept, the Result says
      why and the notice says exactly that instead.
- [ ] A description whose round trip differs from the original **only in blank
      lines between blocks** opens in the rich editor.
- [ ] A description whose round trip would change, drop or reorder any
      non-blank text is still refused. LAI-827's protection against rewriting
      text nobody touched stays, and a test proves it: break the guard and
      watch **that** assertion go red, with the edit confirmed to have landed.
- [ ] Opening a description in the rich editor and leaving without an edit
      saves nothing; the stored text is byte-for-byte unchanged.
- [ ] When the guard does refuse, the notice names the real difference (for
      example *"adds a blank line before line 7"*, or the text that would be
      lost), not a position-shifted line shown as `''`.
- [ ] The repo-root gate exits 0: `pnpm test`, `pnpm lint` and `pnpm format`,
      each redirected to its own file with its own `$?` (CLAUDE.md §5).

## Notes

- `server/web/` only. No new dependency: TipTap is already pinned at 3.32.0 by
  LAI-827.
- CI runs on Linux with wider fonts. A browser test that asserts visible text
  width or wrapping can pass on the Mac and fail on CI; LAI-831 failed CI twice
  that way. Assert on text and state, not layout.
- Out of scope: LAI-840 (adding acceptance criteria where there are none),
  which waits on the owner.
