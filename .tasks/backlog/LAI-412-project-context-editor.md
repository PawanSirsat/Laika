---
id: LAI-412
title: Edit the project context document
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-404]
discovered-from:
status: backlog
---

## Goal

`context_md` is the document served to **every** agent session on the project
(SPEC §7.3) — the thing that is written once instead of re-explained to each
teammate's agent. It needs somewhere to be written.

Project settings, `lead`+ to edit, everyone with project read access can view.

## Acceptance criteria

- [ ] Reads `GET /api/v1/projects/:slug/context` and writes
      `PATCH …/context`. Not the general project `PATCH`.
- [ ] A `viewer` and a `member` see the document read-only, with no edit affordance
      that will fail — not a disabled button with no explanation, and not a
      control that produces a `403`.
- [ ] Editing is plain markdown in a monospace field. **No rich-text editor and
      no new dependency** — the value is served verbatim to agents, so what is
      typed is what ships.
- [ ] The **100,000 character limit is visible before it is hit**: a live count
      that becomes prominent as it approaches, and a save error that names the
      limit and the actual length. SPEC §7.3 is explicit that a context document
      must not silently blow an agent's context window.
- [ ] Unsaved changes are not lost silently on navigation.
- [ ] Shows when it was last edited and by whom, from the endpoint.
- [ ] An empty document gets an empty state that says what the file is **for** —
      architecture and conventions, closed decisions, glossary, things
      deliberately not done — and what does not belong in it: task-specific
      detail, anything secret, anything per-session. Take the wording from
      SPEC §7.3. This is the screen's whole job; a blank textarea teaches nobody.
- [ ] Both themes. Rendered in a real browser.
- [ ] Full gate green.

## Notes

No new dependencies. The monospace font is already self-hosted (JetBrains Mono).
