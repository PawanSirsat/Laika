---
id: LAI-1232
title: 'Board View settings: segmented choices, pinned head and foot, shared settings set apart'
area: web
assignee: shell
priority: p2
depends-on: []
status: review
started: 2026-11-17T10:15:00Z
finished: 2026-11-17T11:05:00Z
---

## Goal

The owner, with a screenshot of the board's View settings popover: improve
its UX and UI. Measured problems: radio rows wrapped wherever the width ran
out (*Sprint* alone under Group by; Hide done split three and three); the whole
panel scrolled, so Close left the top and Reset was out of sight; the shared
setting (Hide done) and the space-settings link were mixed in with personal
ones, each with its own paragraph of disclaimer.

Base: local `ui-round9` @ e0d48e5d. Web only, no server changes, no new
dependencies. Local commits only, not pushed.

## Acceptance criteria

- [x] Group by, Hide done, Card density and Column width are segmented
      controls built on native radios (same `name`s), with a visible focus
      ring and a checked state in both themes.
- [x] Head (title, Close) and foot (Reset) stay put; only the body scrolls.
- [x] Hide done and the Space settings link sit in one "For everyone in this
      space" block; a reader who cannot change Hide done is told its value.
- [x] Filter's Clear all sits on the section's heading row; the empty state
      is one short line.
- [x] Show fields: search box with icon, "Not shown" / "Matching fields" and
      "On cards (n)" sub-heads, and a no-match line.
- [x] Motion uses the `--duration-*` / `--ease-*` tokens; spacing uses the
      scale; the two view-settings exemptions this retired are deleted.
- [x] Typecheck, eslint, prettier, the token/motion/spacing guards (bar a
      pre-existing board-toolbar failure on `ui-round9`) and the eight
      browser suites that drive the panel exit 0.
