---
id: LAI-855
title: 'The rich editor refuses a description that spells < and > as &lt; and &gt;, because it would write \<'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-849
status: backlog
---

## Goal

The owner's agent-written description opens in the rich editor, or the owner
decides it should not. LAI-849 removed the first reason it was refused (a blank
line above a list). This task is the second reason, and it is what still keeps
that description in the Markdown view.

## What was measured (LAI-849, 2026-10-21)

The owner's description was read read-only. It is in another project and is
not quoted here, because the repo is public. With LAI-849's fix it still opens
as Markdown, and the notice now says why, accurately. In the shape of the
made-up text the tests use:

> The rich editor would rewrite line 7: “…reading "Shelve at &lt;branch&gt;" until a `scan` clears…” as “…reading "Shelve at \<branch>" until a `scan` clears…”.

- An agent wrote `<` and `>` as the entities `&lt;` and `&gt;` (twice: in the
  list's first and last items).
- The parser decodes them to `<` and `>`. The faithful writer
  (`escapeFaithfully`) writes a `<` that could start a tag as `\<`, so
  `&lt;name&gt;` comes back as `\<name>`.
- It reads the same and is stored differently. LAI-827 refuses that by design:
  `'a &amp; b'` sits in `markdown-bridge.test.ts` among *"what the editor would
  rewrite opens as Markdown"*.

Untouched blocks are already saved byte for byte (`plan`). The refusal guards
the case where a person edits the block that holds the entity: that block is
rewritten whole, and the entity's spelling changes with it.

## Options, for the owner to choose (this is a design decision, not a fix)

1. **Keep the spelling.** When the source spells a character as an entity,
   write it the same way in a rewritten block, so that `&lt;name&gt;` survives
   an edit elsewhere in that block. The guard is unchanged, so this needs no
   decision about what counts as "the same".
2. **Forgive the spelling at open.** Let a block whose only differences are
   `&lt;` against `\<` (an escape for an entity) open rich. An edit to that
   block would then store `\<name>`, which an agent reading through MCP
   receives instead of `&lt;name&gt;`. This weakens LAI-827's rule, so it needs
   the owner's word.
3. **Leave it refused.** The notice now names the change exactly.

## Acceptance criteria

- [ ] The owner's choice is recorded here, with the reason.
- [ ] If 1 or 2: a made-up description with `&lt;x&gt;` in a list item under
      a paragraph opens rich. An untouched save is the text as stored, and an
      edit to the entity's own block stores what the chosen option says.
- [ ] A change to any other non-blank character is still refused, with a
      mutation-checked test.
- [ ] The repo-root gate exits 0 (CLAUDE.md §5).

## Notes

- `server/web/` only. No new dependency.
- `server/web/test/routes/screens/task/editor/markdown-bridge.test.ts`
  (`ENTITIES`) and `server/web/test/browser/task-panel-editing.test.ts` (*"one
  that also spells < as &lt;"*) both pin today's refusal. Option 1 or 2 turns
  them around.
