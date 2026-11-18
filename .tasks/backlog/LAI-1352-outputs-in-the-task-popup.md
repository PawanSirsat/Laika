---
id: LAI-1352
title: 'Outputs in the task popup: a folded strip in Proof, a viewer, comment thumbnails, unlisted findings, repo block revision 3'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-1302]
status: backlog
---

## Goal

The web half of D-162. The owner chose (2026-11-19) a folded **Outputs** strip **inside Proof**, one per round. It opens to thumbnails with a "+N" overflow, and clicking one opens a viewer.

## Acceptance criteria

- [ ] **In `EvidenceSection`, per round:** a folded line, *"Outputs · 6 — 4 screenshots · 1 sheet · 1 report"*. It opens to a strip:
  - image thumbnails, lazy-loaded and scaled down;
  - other files as `FileGlyph` tiles;
  - a "+N" overflow;
  - the caption under or on hover.
  Reuse the `ev-fold` `<details>`, `fileKind`/`FileGlyph`, the Avatar-style "+N" and the scroll-snap strip pattern.
- [ ] **A viewer (new):**
  - prev and next;
  - "2 / 6";
  - caption;
  - "by <owner>'s <agent>";
  - download;
  - open in a new tab;
  - inline PDF and video (mp4/webm);
  - other types as a download card;
  - keyboard support (←/→/Esc), focus trap, both themes, usable at 390.
- [ ] **Comments with 2 or more images** render as a thumbnail row that opens the viewer. A single image stays as it is today.
- [ ] **`AttachmentsSection`** shows thumbnails for images, grouped "Outputs" / "In comments" / "Other", and keeps its count line.
- [ ] **Inbox › Unlisted** shows a finding's files with the same strip.
- [ ] **Developer access:** a short "Outputs from agents" note in Setup.
- [ ] **The repo block (`connect-copy.ts` `projectBlock`) goes to revision 3**, matching LAI-1351, with rule 7 *"Show the result"*. The web shows "update available" for repos still on revision 2.
- [ ] **Tests:**
  - browser tests at 1440 and 390, in light and dark: the fold count, strip and "+N", viewer keyboard navigation, PDF and video inline, and the comment thumbnail row;
  - the source guards (loading-sweep, board-bands, structure mirror, tokens) are green;
  - any new component CSS is in `screen-styles.ts`.
- [ ] **SPEC §11.4** describes the Outputs strip and viewer, and fixes the drift where it says thumbnails already exist.

## Notes / context

- No server thumbnails in phase 1. Generating them would need an image library, which is a new dependency and its own task.
- Plan: section 3.
