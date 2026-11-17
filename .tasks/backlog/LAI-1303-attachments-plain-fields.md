---
id: LAI-1303
title: 'Attach files from the plain-text fields: time entries, project context, handoff, send-back, day note'
area: web
assignee: unclaimed
priority: p3
depends-on: [LAI-1301]
discovered-from: LAI-1300
status: backlog
---

## Goal

The owner asked for attachments "in many more sections". After tasks and comments (LAI-1301),
the plain `<textarea>` fields that take notes get an attach button that inserts the markdown
link, where the field is rendered as markdown: time-entry descriptions (`my-day/Inspector.tsx`,
`NewEntryPanel.tsx`), project context (`projects/ProjectContextPanel.tsx`), the handoff note,
the send-back reason and the day note. Decide per field whether its reader renders markdown.

## Acceptance criteria

- [ ] A per-field decision recorded, then the button where it applies, gated on
      `OrgView.attachments`.
