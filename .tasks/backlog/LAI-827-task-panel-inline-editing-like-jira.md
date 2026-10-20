---
id: LAI-827
title: 'Task panel edits in place like Jira: hover shows what is editable, click to edit, and the description gets a real editor with a toolbar'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-795
status: backlog
---

## Goal

The task panel reads and edits like Jira's issue view. Owner, 2026-10-21, with
three screenshots of Jira KAN-10 and one of Laika ONR-516:

> *"see how good it looks in JIRA when we hover on the title or on the
> description, and it's fully editable, all tools are there as well, so let's
> implement this in our task detail popup as well, because see how dirty it
> looks in Laika"*

What the screenshots show:
- **Jira:** hovering the title or the description shows a soft grey
  background, nothing else. Clicking turns it into an editor in place: the
  title into an input, the description into a rich editor with a toolbar
  (text style, bold, lists, code, link, mention, undo/redo) and Save / Cancel
  under it. Reading and editing look like the same document.
- **Laika (ONR-516):** the description is a cramped box with small text, and
  an "Edit description" button floats over the first lines of text.

Made on the owner's direct instruction (CLAUDE.md §4.2 "if you are one agent
doing all of it").

## Acceptance criteria

- [ ] **Hover affordance.** Title, description, acceptance criteria and the
      editable fields in Details (assignee, priority, labels, dates, sprint,
      effort) show a soft background on hover and a text cursor / pointer,
      in light and dark, only for people who may edit the task. Readers who
      cannot edit see no hover and no editor.
- [ ] **Title in place.** Click the title: it becomes an input with the same
      font and size. Enter or blur saves; Esc cancels; empty is refused.
- [ ] **Description and acceptance in place.** Click (anywhere not on a
      link): a rich editor opens in place with a toolbar and Save / Cancel.
      ⌘/Ctrl+Enter saves, Esc cancels (asks first if there are unsaved
      changes). The floating "Edit description" button is gone.
- [ ] **Toolbar:** paragraph / H1–H3, bold, italic, strikethrough, inline
      code, bullet list, numbered list, checklist, quote, code block, link,
      table (insert and edit rows/columns), @mention a member, link a card by
      key, undo, redo, and a **Markdown** toggle that shows the source. No
      image upload and no text colour: Laika has no uploads and markdown
      cannot store colour.
- [ ] **Markdown stays the stored format, and nothing is silently
      rewritten.** `description_md` and `acceptance_md` stay markdown. When a
      document opens, the editor checks that parsing and re-serialising it
      gives the same markdown (after a stated normalisation). If it does not
      (an agent wrote something the editor cannot represent), that document
      opens in Markdown source mode and says why, so saving never changes
      text the person did not touch. A Save with no change sends nothing.
- [ ] **Safety unchanged.** What is shown after saving renders through the
      same safe renderer as today: raw HTML stays text, `javascript:` links
      are disabled, images never load. The editor itself never executes or
      loads pasted HTML; pasting from Jira, Docs or a web page keeps text,
      lists, links and tables, nothing else.
- [ ] **Stale-text protection from LAI-795 holds.** The editor stays locked
      while the full text loads or is stale, and a save made against an older
      version is refused with a clear message, not written over newer text.
- [ ] **Comment composer** uses the same editor (toolbar, mentions, card
      links, Markdown toggle).
- [ ] **Reading view** of description, acceptance and comments uses the
      larger reading size defined in LAI-828 if it has landed, otherwise
      15px with line-height 1.6, through the type tokens, not hard-coded
      sizes.
- [ ] **Bundle.** The editor is lazy-loaded the first time someone edits, so
      the Board and List do not download it. Report the main bundle and the
      editor chunk sizes before and after (gzip).
- [ ] **Tests.** Browser tests for: hover only for editors; title edit and
      Esc; description edit, toolbar actions, Save and Cancel; the round-trip
      guard opening an agent-written document in source mode; a stale save
      refused; no request on an unchanged Save; paste stripping HTML. Each
      fails on today's code.
- [ ] **Screenshots** before and after, light and dark, 1440 and 390, of a
      long agent-written description like ONR-516, reading and editing.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- **New dependencies allowed by this task, and only these:** `@tiptap/react`,
  `@tiptap/pm`, `@tiptap/starter-kit`, the TipTap extensions needed for link,
  task list / task item, table, placeholder and mention (all `@tiptap/*`),
  and one markdown bridge: the official `@tiptap/markdown` if it exists at a
  version matching the other `@tiptap/*` packages, otherwise `tiptap-markdown`.
  Check each is MIT-licensed and record versions and licences in the task
  file. Pin exact versions in `server/web/package.json`; update the lockfile.
- Self-host everything: no CDN, no remote fonts, no telemetry.
- Mention and card-link suggestions use endpoints that already exist
  (members, tasks search); do not add server endpoints in this task. If one
  is genuinely missing, file it and ship without that suggestion.
