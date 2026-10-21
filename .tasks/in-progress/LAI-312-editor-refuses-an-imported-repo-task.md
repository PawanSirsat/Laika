---
id: LAI-312
title: 'An imported repo task opens as Markdown, "The rich editor could not read it" (LAI-624 / LAIKA-439)'
area: shell
assignee: strelka
priority: p1
depends-on: []
discovered-from: owner report 2026-10-21
status: in-progress
started: 2026-10-21T17:54:43Z
---

## Goal

The owner opened card LAIKA-439 (`LAI-624 · The docs describe a CLI
invocation and a setup path that do not exist`) and the editor said *"Opened
as Markdown, so nothing you do not touch changes. The rich editor could not
read it."* Every card imported from `.tasks/` carries the same constructs, so
every one of them opens the same way.

The body is ordinary markdown. The rich editor should open it, and an
untouched save must still be the source byte for byte (LAI-827). That
guarantee is not weakened to get there.

## What was measured (2026-10-21, on `66cec001`, built on Strelka)

The real `description_md` was fed to `openDocument` in
`server/web/src/routes/screens/task/editor/markdown-bridge.ts`. Four separate
constructs refuse it:

| # | Construct in the body | What happens |
| --- | --- | --- |
| A | inline code inside italic, bold or a link: `` _from the `.tasks/` folder._ ``, `` [`path`](url) ``, `` *"written by `/laika:setup`"* `` | `parseMarkdown` returns `null`: TipTap's `code` mark excludes every other mark, so the parsed JSON is invalid for the schema (`Invalid collection of marks for node text: code,italic`). **This is the notice the owner saw.** |
| B | `### 1. \`npx laika init\` cannot work` | the faithful escaper treats `1.` as an ordered-list marker inside a heading and writes `### 1\.` |
| C | a bullet wrapped onto a 2-space continuation line | the editor drops the indent. **PR #13 (LAI-853) fixes this.** |
| D | a task-list item wrapped onto a 6-space line | TipTap reads the second line as a code block. **Filed as LAI-302** on LAI-853's branch. |

Underneath A is a second refusal: once the code mark may combine, `_…_` is
rewritten `*…*`, because the italic mark does not remember its delimiter.
Every imported card opens with `_Imported … from the repo's `.tasks/` folder._`.

A, B and the `_` delimiter are this task. C and D are not, and are owned
where named above.

## Acceptance criteria

- [ ] A failing test, using the real body as a fixture, is committed before
      the fix.
- [ ] Inline code inside italic, bold, strikethrough and a link opens in the
      rich editor and round-trips byte-exact.
- [ ] `_italic_` round-trips as `_italic_`, and `*italic*` as `*italic*`; an
      italic made in the editor is still written `*…*`.
- [ ] A heading whose text starts `1.`, `-`, `>` or `+` round-trips without an
      escape, and a heading of only `#` is still escaped.
- [ ] The real body with its wrapped list items unwrapped (C and D) opens
      rich and writes back byte-exact; the real body as it is now gets a
      notice naming a line, not *"could not read it"*.
- [ ] The fix is broken once, and a named test goes red.
- [ ] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Notes / context

- No new dependency: the `code` and `italic` marks are reached through
  `StarterKit.extend` and `this.parent()`, not `@tiptap/extension-code`.
- PRs #13 and #20 touch the same file; the PR records a trial merge with both.
