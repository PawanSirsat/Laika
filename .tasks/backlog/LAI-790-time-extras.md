---
id: LAI-790
title: 'Time, phase 4: Codex and Gemini signals in drafts, and draft accuracy'
area: cli
assignee: unclaimed
priority: p3
depends-on: [LAI-787]
discovered-from:
status: backlog
---

## Goal

Drafts include Codex and Gemini CLI sessions, and Laika measures how good its
drafts are (how often a day is confirmed unchanged, and by how much people
edit), so the drafter can be tuned.

## Acceptance criteria

- [ ] Codex and Gemini session timestamps feed the same blocks, timestamps
      only, under the same switches and exclusions.
- [ ] Draft accuracy recorded per project (unchanged confirms, minutes
      edited), never per person.
- [ ] Gate: test, lint, format exit 0.

## Notes / context

~/Documents/laika-strategy/time-tracking/design/REPORT.md §2.5 error sources and §5.
