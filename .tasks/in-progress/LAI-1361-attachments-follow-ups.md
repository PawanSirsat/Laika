---
id: LAI-1361
title: 'Attachments follow-ups: download=1, unlisted file details, secret-scan weak cases, nested zips'
area: server
assignee: core
priority: p2
depends-on: [LAI-1302, LAI-1351, LAI-1352]
status: in-progress
started: 2026-11-19T05:36:46Z
---

## Goal

Follow-ups found in the reviews of D-162's children. Board card LAIKA-1155, a child of the parent LAIKA-1153. None blocks anything live.

## Acceptance criteria

- [ ] **`GET /attachments/:id/content?download=1`** sends `Content-Disposition: attachment` on the store's presigned GET, so Download saves images and PDFs. The web's Download then uses it instead of opening a new tab. Named crossing: `server/web/` (Download link), for this one link only.
- [ ] **`GET /unlisted`** returns each finding's file details (id, filename, content_type, size_bytes, inline), so the Inbox › Unlisted strip can label a non-image file.
- [ ] **Secret scan, `server/src/services/secret-scan.ts` and its CLI mirror together** (the comparison test stays green). Each change gets a must-pass test and a still-caught pair; the 2 MiB timing tests stay green. These are now missed and must be caught:
  - `password: dragon`;
  - `password: hunter22 (temp)`;
  - `user,pass` / `user,token` columns holding a real secret;
  - `<password>…</password>` XML.

  These are still wrongly refused and must pass: `pwd=$(pwd)` in a .sh file, and the `ab**yz` mask.
- [ ] **CLI:** a .zip or .pptx nested inside an upload is opened and scanned within the same budgets, or refused as unreadable.

## Notes / context

- Found in review-405, review-407 and review-409 (2026-11-19).
- Plan: `~/.claude/plans/now-you-have-very-validated-perlis.md`.
