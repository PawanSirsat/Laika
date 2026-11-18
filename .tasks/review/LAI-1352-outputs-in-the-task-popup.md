---
id: LAI-1352
title: 'Outputs in the task popup: a folded strip in Proof, a viewer, comment thumbnails, unlisted findings, repo block revision 3'
area: web
assignee: shell
priority: p1
depends-on: [LAI-1302]
status: review
started: 2026-11-18T21:53:51Z
finished: 2026-11-18T22:36:20Z
---

## Goal

The web half of D-162. The owner chose (2026-11-19) a folded **Outputs** strip **inside Proof**, one per round. It opens to thumbnails with a "+N" overflow, and clicking one opens a viewer.

## Acceptance criteria

- [x] **In `EvidenceSection`, per round:** a folded line, *"Outputs · 6 — 4 screenshots · 1 sheet · 1 report"*. It opens to a strip:
  - image thumbnails, lazy-loaded and scaled down;
  - other files as `FileGlyph` tiles;
  - a "+N" overflow;
  - the caption under or on hover.
  Reuse the `ev-fold` `<details>`, `fileKind`/`FileGlyph`, the Avatar-style "+N" and the scroll-snap strip pattern.
- [x] **A viewer (new):**
  - prev and next;
  - "2 / 6";
  - caption;
  - "by <owner>'s <agent>";
  - download;
  - open in a new tab;
  - inline PDF and video (mp4/webm);
  - other types as a download card;
  - keyboard support (←/→/Esc), focus trap, both themes, usable at 390.
- [x] **Comments with 2 or more images** render as a thumbnail row that opens the viewer. A single image stays as it is today.
- [x] **`AttachmentsSection`** shows thumbnails for images, grouped "Outputs" / "In comments" / "Other", and keeps its count line.
- [x] **Inbox › Unlisted** shows a finding's files with the same strip.
- [x] **Developer access:** a short "Outputs from agents" note in Setup.
- [x] **The repo block (`connect-copy.ts` `projectBlock`) goes to revision 3**, matching LAI-1351, with rule 7 *"Show the result"*. The web shows "update available" for repos still on revision 2.
- [x] **Tests:**
  - browser tests at 1440 and 390, in light and dark: the fold count, strip and "+N", viewer keyboard navigation, PDF and video inline, and the comment thumbnail row;
  - the source guards (loading-sweep, board-bands, structure mirror, tokens) are green;
  - any new component CSS is in `screen-styles.ts`.
- [x] **SPEC §11.4** describes the Outputs strip and viewer, and fixes the drift where it says thumbnails already exist.
- [x] **The parent and child rule** (owner, 2026-11-19; LAI-1360 has the server side): a new feature with several parts gets one parent task, with each part as a child task. Work on an existing feature becomes a new child of its parent. A genuinely small one-off may stand alone. The main outputs go on the parent, a child's own outputs on the child.
  It goes into repo block revision 3 (`connect-copy.ts` `projectBlock`) and every Developer access prompt that tells an agent how to work (the Project setup prompt, the machine prompt in `connect-agents.ts`, and the Tools and Activity setup copy).
- [x] **Testing (owner):** attach this task's own screenshots to the parent card LAIKA-1153 on Ksage: the Outputs strip and viewer at 1440 and 390, in light and dark. Upload them through the existing REST API (agent tokens may already use it; see LAI-1302's notes). The parent then shows how the feature looks.

## Notes / context

- **Deviation (§2 step 1):** built against PR #405 (LAI-1302, branch `LAI-1302-attachments-agents`) before it merged, at CHIEF's direction, 2026-11-19. LAI-1302 sits in review, not done.

- No server thumbnails in phase 1. Generating them would need an image library, which is a new dependency and its own task.
- Plan: section 3.

## Builder notes (SHELL, Belka, 2026-11-19)

- **PR #409** into `integration-ksage`, branch `LAI-1352-outputs-popup`. Built
  against #405 before it merged (the deviation above); #405 has since merged
  and `integration-ksage` is merged back in, so the PR is only this task.
- **Repo block revision 3**, the words LAI-1351 copies (`connect-copy.ts`,
  `SHOW_THE_RESULT` and `ONE_PARENT_PER_FEATURE`), after rule 6 of the marked
  block. The classic unmarked block is unchanged (revision 1, its hash holds):
  - 7. **Show the result.** When a person needs to see what you did — a UI
    change, a generated file — attach screenshots or outputs with
    `laika attach` or `request_upload`, each with a caption, and pass them to
    `finish_task` as `outputs`. Skip it when tests are the whole proof. Never
    upload a secret: attach a masked copy, and say where the real file is kept.
  - 8. **One parent per feature.** A new feature with several parts gets one
    parent task, with each part as a child task (`create_task` with
    `parent`). Work on an existing feature becomes a new child of its parent.
    A genuinely small one-off may stand alone. The main outputs go on the
    parent, a child's own outputs on the child.
- **Viewer, two limits from the server side, reported not built (web only):**
  - *Inline PDF* is a frame. Production's CSP names the store under `img-src`,
    `media-src` and `connect-src` but not `frame-src`, so today the frame is
    refused; the viewer catches the `securitypolicyviolation` and shows the
    download card instead (tested with a real CSP and a 302). It shows inline
    by itself once `frame-src` names the store (`server/src/http/
    security-headers.ts` and `docker/web/security-headers.conf`).
  - *Download* of a file the server serves inline (an image, a PDF) may open
    rather than save: `download` is ignored across the 302 to the store. A
    `?download=1` on the content route would settle it.
- **Unlisted:** `GET /unlisted` has no file list, so the strip reads the
  note's `**Attached**` block. An image shows; any other file is a card named
  by its caption, with no name, type or size.
- **Screenshots** (strip and viewer, 1440 and 390, light and dark, local
  build) are on LAIKA-1153, comment 01M7RCMDV4QW2A3QBMXW1TCFC1.
- **Two owners, §4.4: this half is red alone, by design.** `Gate · cli` fails
  one assertion, `cli/test/project-check.test.ts:951`, *drift: the CLI reads
  the block the web writes › the same template revision, end marker and
  begin-marker shape*:
  `The input did not match the regular expression /export const PROJECT_BLOCK_REVISION = 2;/`
  — the web is at 3 and `cli/src/project-check.ts:92` still says 2.
  **LAI-1351 (PR #407, branch `LAI-1351-laika-attach`) turns it green**: its
  `cli/src/project-check.ts` is already at 3, and alone it fails the same
  assertion the other way. Land the two together; no exemption taken, and
  `cli/` is not crossed from here.

