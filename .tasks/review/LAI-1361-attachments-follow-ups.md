---
id: LAI-1361
title: 'Attachments follow-ups: download=1, unlisted file details, secret-scan weak cases, nested zips'
area: server
assignee: core
priority: p2
depends-on: [LAI-1302, LAI-1351, LAI-1352]
status: review
finished: 2026-11-19T06:48:19Z
started: 2026-11-19T05:36:46Z
---

## Goal

Follow-ups found in the reviews of D-162's children. Board card LAIKA-1155, a child of the parent LAIKA-1153. None blocks anything live.

## Acceptance criteria

- [x] **`GET /attachments/:id/content?download=1`** sends `Content-Disposition: attachment` on the store's presigned GET, so Download saves images and PDFs. The web's Download then uses it instead of opening a new tab. Named crossing: `server/web/` (Download link), for this one link only.
- [x] **`GET /unlisted`** returns each finding's file details (id, filename, content_type, size_bytes, inline), so the Inbox › Unlisted strip can label a non-image file.
- [x] **Secret scan, `server/src/services/secret-scan.ts` and its CLI mirror together** (the comparison test stays green). Each change gets a must-pass test and a still-caught pair; the 2 MiB timing tests stay green. These are now missed and must be caught:
  - `password: dragon`;
  - `password: hunter22 (temp)`;
  - `user,pass` / `user,token` columns holding a real secret;
  - `<password>…</password>` XML.

  These are still wrongly refused and must pass: `pwd=$(pwd)` in a .sh file, and the `ab**yz` mask.
- [x] **CLI:** a .zip or .pptx nested inside an upload is opened and scanned within the same budgets, or refused as unreadable.

## Notes / context

- Found in review-405, review-407 and review-409 (2026-11-19).
- Plan: `~/.claude/plans/now-you-have-very-validated-perlis.md`.

## Builder notes (core, Belka, review)

PR #415 into `integration-ksage`, branch `LAI-1361-attachments-follow-ups`.

- **download=1.** `attachmentContentUrl` takes `download`. The presigned GET
  then signs `response-content-disposition=attachment; filename=…;
  filename*=UTF-8''…` for every file, with the type unchanged. `?download=`
  with anything but `1` or `0` is a 400. The fake store's signature check
  proves it is signed. The read gate is now one function, `mayReadFile`.
- **Named crossing, `server/web/`:** the output viewer's *Download* link only.
  It is `?download=1` with `download`, and no `target=_blank`. The
  Attachments section opens the same viewer, so its Download is this link
  too; the section's filename link (open) is unchanged. A download's own
  request is not one Playwright's `page.route` sees, so the browser test
  answers it from the stub board.
- **Unlisted files.** `GET /unlisted` rows are `UnlistedEntryView extends
  UnlistedView` with `files: UnlistedFileView[]`, gated by `mayReadFile`, the
  content route's own check. The web pairs them as `UnlistedWork extends
  UnlistedNote` and `UnlistedFile`. Promote answers `UnlistedNote`, because
  promote lists no files. The Inbox strip passes the files to `outputItems`,
  so a file the reader may not open, or one removed since, is left out, as a
  task's is.
- **Secret scan**, the same text on both sides:
  - a plain word is a password unless it describes the field (`required`,
    `string`, and about 40 others);
  - a note in brackets may follow the value;
  - `<password>` elements are read, with a prefix or attributes;
  - a bare `pass` or `token` column counts for a cell of 8 or more
    characters with letters and digits;
  - `$(…)` and two stars in a row are masked.

  Every existing case is kept. The new shapes have their own 2 MiB timing
  test.
- **CLI zips.**
  - `zipContents` reads any zip: office parts (now `.pptx` slides and notes,
    through the Word reader, since DrawingML uses the same local names), plus
    files (a plain zip's entries, an office file's `*/embeddings/*`).
  - `scanFile` recurses up to `MAX_DEPTH` 4 with one shared `Budget`.
  - A plain zip at the top was passed unread before; it is now opened.

